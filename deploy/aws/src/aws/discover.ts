/**
 * Descubre lo que el usuario ya tiene montado. Todo es de solo lectura salvo `createDbSecret` y
 * `createRedisSecret`, que guardan en Secrets Manager credenciales que el usuario teclea (para no
 * escribirlas nunca en un fichero ni en la plantilla).
 */
import { ACMClient, DescribeCertificateCommand, ListCertificatesCommand } from '@aws-sdk/client-acm'
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation'
import {
  DescribeAvailabilityZonesCommand,
  DescribeManagedPrefixListsCommand,
  DescribeRegionsCommand,
  DescribeRouteTablesCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  EC2Client,
  type RouteTable,
} from '@aws-sdk/client-ec2'
import {
  DescribeCacheClustersCommand,
  DescribeCacheSubnetGroupsCommand,
  DescribeReplicationGroupsCommand,
  DescribeServerlessCachesCommand,
  ElastiCacheClient,
} from '@aws-sdk/client-elasticache'
import {
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  DescribeDBSubnetGroupsCommand,
  RDSClient,
} from '@aws-sdk/client-rds'
import { ListHostedZonesCommand, Route53Client } from '@aws-sdk/client-route-53'
import { CreateSecretCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { GetServiceQuotaCommand, ServiceQuotasClient } from '@aws-sdk/client-service-quotas'
import { CARTERO_IMAGE, type SubnetRef } from '../config.js'
import type { Session } from './session.js'

const opts = (s: Session) => ({ region: s.region, credentials: s.credentials })

// ─── Región y CDK ──────────────────────────────────────────────────────────────────────────────

export async function listRegions(s: Session): Promise<string[]> {
  const r = await new EC2Client(opts(s)).send(new DescribeRegionsCommand({}))
  return (r.Regions ?? [])
    .map((x) => x.RegionName ?? '')
    .filter(Boolean)
    .sort()
}

/** ¿Está CDK inicializado en la región (pila CDKToolkit)? */
export async function cdkBootstrapped(s: Session): Promise<boolean> {
  try {
    const r = await new CloudFormationClient(opts(s)).send(
      new DescribeStacksCommand({ StackName: 'CDKToolkit' }),
    )
    const st = r.Stacks?.[0]?.StackStatus ?? ''
    return /COMPLETE$/.test(st) && !/DELETE|ROLLBACK_COMPLETE$/.test(st)
  } catch {
    return false
  }
}

export interface StackInfo {
  status: string
  outputs: Record<string, string>
}

export async function stackInfo(s: Session, name: string): Promise<StackInfo | null> {
  try {
    const r = await new CloudFormationClient(opts(s)).send(new DescribeStacksCommand({ StackName: name }))
    const st = r.Stacks?.[0]
    if (!st) return null
    return {
      status: st.StackStatus ?? '',
      outputs: Object.fromEntries((st.Outputs ?? []).map((o) => [o.OutputKey ?? '', o.OutputValue ?? ''])),
    }
  } catch {
    return null
  }
}

// ─── Red ─────────────────────────────────────────────────────────────────────────────────────

/** Las dos primeras zonas disponibles de la región (para una VPC nueva). */
export async function twoAzs(s: Session): Promise<string[]> {
  const r = await new EC2Client(opts(s)).send(
    new DescribeAvailabilityZonesCommand({
      Filters: [
        { Name: 'state', Values: ['available'] },
        { Name: 'zone-type', Values: ['availability-zone'] },
      ],
    }),
  )
  return (r.AvailabilityZones ?? [])
    .map((z) => z.ZoneName ?? '')
    .filter(Boolean)
    .sort()
    .slice(0, 2)
}

export interface SubnetInfo extends SubnetRef {
  cidr: string
  name?: string
  public: boolean
}

export interface VpcInfo {
  id: string
  cidr: string
  name?: string
  isDefault: boolean
  subnets: SubnetInfo[]
}

/**
 * Una subred es pública si su tabla de rutas (la asociada o, si no tiene, la principal de la VPC)
 * manda 0.0.0.0/0 a un Internet Gateway.
 */
export function isPublicSubnet(subnetId: string, vpcId: string, tables: RouteTable[]): boolean {
  const own = tables.find((t) => t.Associations?.some((a) => a.SubnetId === subnetId))
  const table = own ?? tables.find((t) => t.VpcId === vpcId && t.Associations?.some((a) => a.Main))
  return Boolean(
    table?.Routes?.some((r) => r.DestinationCidrBlock === '0.0.0.0/0' && r.GatewayId?.startsWith('igw-')),
  )
}

const nameTag = (tags?: { Key?: string; Value?: string }[]) => tags?.find((t) => t.Key === 'Name')?.Value

export async function listVpcs(s: Session): Promise<VpcInfo[]> {
  const ec2 = new EC2Client(opts(s))
  const [vpcs, subnets, tables] = await Promise.all([
    ec2.send(new DescribeVpcsCommand({})),
    ec2.send(new DescribeSubnetsCommand({})),
    ec2.send(new DescribeRouteTablesCommand({})),
  ])
  const rts = tables.RouteTables ?? []
  return (vpcs.Vpcs ?? []).map((v) => ({
    id: v.VpcId ?? '',
    cidr: v.CidrBlock ?? '',
    name: nameTag(v.Tags),
    isDefault: Boolean(v.IsDefault),
    subnets: (subnets.Subnets ?? [])
      .filter((sn) => sn.VpcId === v.VpcId)
      .map((sn) => ({
        id: sn.SubnetId ?? '',
        az: sn.AvailabilityZone ?? '',
        cidr: sn.CidrBlock ?? '',
        name: nameTag(sn.Tags),
        public: isPublicSubnet(sn.SubnetId ?? '', v.VpcId ?? '', rts),
      }))
      .sort((a, b) => a.az.localeCompare(b.az)),
  }))
}

/** ¿Cabe otra VPC en la región? La cuota por defecto es 5 (L-F678F1CE). */
export async function vpcRoom(s: Session): Promise<{ used: number; limit: number }> {
  const [vpcs, quota] = await Promise.all([
    new EC2Client(opts(s)).send(new DescribeVpcsCommand({})),
    new ServiceQuotasClient(opts(s))
      .send(new GetServiceQuotaCommand({ ServiceCode: 'vpc', QuotaCode: 'L-F678F1CE' }))
      .then((r) => r.Quota?.Value)
      .catch(() => undefined),
  ])
  return { used: vpcs.Vpcs?.length ?? 0, limit: quota ?? 5 }
}

/** Una subred por zona (la primera), para no repetir zonas en el ALB. */
export function onePerAz<T extends SubnetRef>(subnets: T[]): T[] {
  const seen = new Set<string>()
  return subnets.filter((s) => {
    if (seen.has(s.az)) return false
    seen.add(s.az)
    return true
  })
}

/** Lista de prefijos de CloudFront (origin-facing) de la región, para cerrar el ALB al resto. */
export async function cloudfrontPrefixList(s: Session): Promise<string | undefined> {
  const r = await new EC2Client(opts(s)).send(
    new DescribeManagedPrefixListsCommand({
      Filters: [{ Name: 'prefix-list-name', Values: ['com.amazonaws.global.cloudfront.origin-facing'] }],
    }),
  )
  return r.PrefixLists?.[0]?.PrefixListId
}

// ─── Base de datos ─────────────────────────────────────────────────────────────────────────────

export interface PostgresInfo {
  id: string
  kind: 'instance' | 'cluster'
  engine: string
  version: string
  host: string
  port: number
  dbName?: string
  vpcId?: string
  securityGroupId?: string
  /** Secreto gestionado por RDS (username y password), si lo tiene */
  masterSecretArn?: string
  masterUser?: string
}

export async function listPostgres(s: Session): Promise<PostgresInfo[]> {
  const rds = new RDSClient(opts(s))
  const [inst, clus, groups] = await Promise.all([
    rds.send(new DescribeDBInstancesCommand({})),
    rds.send(new DescribeDBClustersCommand({})).catch(() => ({ DBClusters: [] })),
    rds.send(new DescribeDBSubnetGroupsCommand({})),
  ])
  const vpcOf = new Map((groups.DBSubnetGroups ?? []).map((g) => [g.DBSubnetGroupName, g.VpcId]))
  const out: PostgresInfo[] = []
  for (const c of clus.DBClusters ?? []) {
    if (!c.Engine?.includes('postgres') || !c.Endpoint) continue
    out.push({
      id: c.DBClusterIdentifier ?? '',
      kind: 'cluster',
      engine: c.Engine,
      version: c.EngineVersion ?? '',
      host: c.Endpoint,
      port: c.Port ?? 5432,
      dbName: c.DatabaseName,
      vpcId: vpcOf.get(c.DBSubnetGroup),
      securityGroupId: c.VpcSecurityGroups?.[0]?.VpcSecurityGroupId,
      masterSecretArn: c.MasterUserSecret?.SecretArn,
      masterUser: c.MasterUsername,
    })
  }
  for (const i of inst.DBInstances ?? []) {
    // Las instancias de un clúster ya salen con el clúster
    if (!i.Engine?.includes('postgres') || i.DBClusterIdentifier || !i.Endpoint?.Address) continue
    out.push({
      id: i.DBInstanceIdentifier ?? '',
      kind: 'instance',
      engine: i.Engine,
      version: i.EngineVersion ?? '',
      host: i.Endpoint.Address,
      port: i.Endpoint.Port ?? 5432,
      dbName: i.DBName,
      vpcId: i.DBSubnetGroup?.VpcId,
      securityGroupId: i.VpcSecurityGroups?.[0]?.VpcSecurityGroupId,
      masterSecretArn: i.MasterUserSecret?.SecretArn,
      masterUser: i.MasterUsername,
    })
  }
  return out
}

/** Guarda usuario y contraseña de una base de datos existente en un secreto nuevo. Devuelve su ARN. */
export async function createDbSecret(
  s: Session,
  stackName: string,
  username: string,
  password: string,
): Promise<string> {
  const r = await new SecretsManagerClient(opts(s)).send(
    new CreateSecretCommand({
      Name: `cartero/${stackName}/database-${Date.now()}`,
      Description: `Credenciales de la base de datos de Cartero (${stackName})`,
      SecretString: JSON.stringify({ username, password }),
      Tags: [
        { Key: 'app', Value: 'cartero' },
        { Key: 'cartero:stack', Value: stackName },
      ],
    }),
  )
  return r.ARN ?? ''
}

export async function createRedisSecret(s: Session, stackName: string, password: string): Promise<string> {
  const r = await new SecretsManagerClient(opts(s)).send(
    new CreateSecretCommand({
      Name: `cartero/${stackName}/redis-${Date.now()}`,
      Description: `Contraseña de Redis de Cartero (${stackName})`,
      SecretString: JSON.stringify({ password }),
      Tags: [
        { Key: 'app', Value: 'cartero' },
        { Key: 'cartero:stack', Value: stackName },
      ],
    }),
  )
  return r.ARN ?? ''
}

// ─── Redis / Valkey ────────────────────────────────────────────────────────────────────────────

export interface CacheInfo {
  id: string
  kind: 'cluster' | 'replication-group' | 'serverless'
  engine: string
  host: string
  port: number
  tls: boolean
  auth: boolean
  vpcId?: string
  /** Los serverless no dicen su VPC, pero sí sus subredes */
  subnetIds?: string[]
  securityGroupId?: string
}

/** ¿El Redis está en la VPC? Por su VPC o, si no la dice (serverless), por sus subredes. */
export function cacheInVpc(c: CacheInfo, vpc: VpcInfo): boolean {
  if (c.vpcId) return c.vpcId === vpc.id
  return Boolean(c.subnetIds?.some((id) => vpc.subnets.some((s) => s.id === id)))
}

export async function listCaches(s: Session): Promise<CacheInfo[]> {
  const ec = new ElastiCacheClient(opts(s))
  const [clusters, groups, serverless, subnetGroups] = await Promise.all([
    ec.send(new DescribeCacheClustersCommand({ ShowCacheNodeInfo: true })),
    ec.send(new DescribeReplicationGroupsCommand({})),
    ec.send(new DescribeServerlessCachesCommand({})).catch(() => ({ ServerlessCaches: [] })),
    ec.send(new DescribeCacheSubnetGroupsCommand({})),
  ])
  const vpcOf = new Map((subnetGroups.CacheSubnetGroups ?? []).map((g) => [g.CacheSubnetGroupName, g.VpcId]))
  const byId = new Map((clusters.CacheClusters ?? []).map((c) => [c.CacheClusterId, c]))
  const isRedis = (e?: string) => e === 'redis' || e === 'valkey'
  const out: CacheInfo[] = []

  for (const g of groups.ReplicationGroups ?? []) {
    // Cartero usa un Redis normal (BullMQ sin modo clúster)
    if (g.ClusterEnabled) continue
    const ep = g.NodeGroups?.[0]?.PrimaryEndpoint
    const member = byId.get(g.MemberClusters?.[0])
    if (!ep?.Address || !isRedis(member?.Engine ?? g.Engine)) continue
    out.push({
      id: g.ReplicationGroupId ?? '',
      kind: 'replication-group',
      engine: g.Engine ?? member?.Engine ?? 'redis',
      host: ep.Address,
      port: ep.Port ?? 6379,
      tls: Boolean(g.TransitEncryptionEnabled),
      auth: Boolean(g.AuthTokenEnabled),
      vpcId: vpcOf.get(member?.CacheSubnetGroupName),
      securityGroupId: member?.SecurityGroups?.[0]?.SecurityGroupId,
    })
  }
  for (const c of clusters.CacheClusters ?? []) {
    if (c.ReplicationGroupId || !isRedis(c.Engine)) continue
    const ep = c.CacheNodes?.[0]?.Endpoint
    if (!ep?.Address) continue
    out.push({
      id: c.CacheClusterId ?? '',
      kind: 'cluster',
      engine: c.Engine ?? 'redis',
      host: ep.Address,
      port: ep.Port ?? 6379,
      tls: Boolean(c.TransitEncryptionEnabled),
      auth: Boolean(c.AuthTokenEnabled),
      vpcId: vpcOf.get(c.CacheSubnetGroupName),
      securityGroupId: c.SecurityGroups?.[0]?.SecurityGroupId,
    })
  }
  for (const sc of serverless.ServerlessCaches ?? []) {
    if (!isRedis(sc.Engine) || !sc.Endpoint?.Address || sc.Status !== 'available') continue
    out.push({
      id: sc.ServerlessCacheName ?? '',
      kind: 'serverless',
      engine: sc.Engine ?? 'valkey',
      host: sc.Endpoint.Address,
      port: sc.Endpoint.Port ?? 6379,
      tls: true,
      auth: Boolean(sc.UserGroupId),
      subnetIds: sc.SubnetIds,
      securityGroupId: sc.SecurityGroupIds?.[0],
    })
  }
  return out
}

// ─── Dominio ───────────────────────────────────────────────────────────────────────────────────

export interface ZoneInfo {
  id: string
  name: string
}

export async function listZones(s: Session): Promise<ZoneInfo[]> {
  const r = await new Route53Client(opts(s)).send(new ListHostedZonesCommand({}))
  return (r.HostedZones ?? [])
    .filter((z) => !z.Config?.PrivateZone)
    .map((z) => ({ id: (z.Id ?? '').replace('/hostedzone/', ''), name: (z.Name ?? '').replace(/\.$/, '') }))
}

/** ¿El certificado cubre el nombre? Exacto o comodín de un solo nivel (*.midominio.com). */
export function certCovers(names: string[], host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return names.some((n) => {
    const d = n.toLowerCase().replace(/\.$/, '')
    if (d === h) return true
    if (!d.startsWith('*.')) return false
    const rest = h.slice(h.indexOf('.') + 1)
    return h.includes('.') && rest === d.slice(2)
  })
}

export interface CertInfo {
  arn: string
  domain: string
}

/** Certificados emitidos en la región que cubren el nombre (para el ALB de Fargate). */
export async function findCertificates(s: Session, host: string): Promise<CertInfo[]> {
  const acm = new ACMClient(opts(s))
  const list = await acm.send(new ListCertificatesCommand({ CertificateStatuses: ['ISSUED'] }))
  const out: CertInfo[] = []
  for (const c of list.CertificateSummaryList ?? []) {
    let names = c.SubjectAlternativeNameSummaries ?? [c.DomainName ?? '']
    if (c.HasAdditionalSubjectAlternativeNames && c.CertificateArn) {
      const d = await acm.send(new DescribeCertificateCommand({ CertificateArn: c.CertificateArn }))
      names = d.Certificate?.SubjectAlternativeNames ?? names
    }
    if (c.CertificateArn && certCovers(names, host))
      out.push({ arn: c.CertificateArn, domain: c.DomainName ?? host })
  }
  return out
}

// ─── Imagen ────────────────────────────────────────────────────────────────────────────────────

/** Comprueba que la etiqueta existe en GHCR (la imagen es pública: sin credenciales). */
export async function imageTagExists(tag: string): Promise<boolean> {
  const repo = CARTERO_IMAGE.replace('ghcr.io/', '')
  const tok = (await (await fetch(`https://ghcr.io/token?scope=repository:${repo}:pull`)).json()) as {
    token: string
  }
  const r = await fetch(`https://ghcr.io/v2/${repo}/manifests/${tag}`, {
    method: 'HEAD',
    headers: {
      Authorization: `Bearer ${tok.token}`,
      Accept: [
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.docker.distribution.manifest.v2+json',
      ].join(', '),
    },
  })
  return r.ok
}

/** La versión más alta publicada en GitHub (sin borradores, prereleases ni la app de escritorio). */
export function pickLatestVersion(releases: unknown): string | undefined {
  if (!Array.isArray(releases)) return undefined
  const versions = releases
    .filter((r) => r && !r.draft && !r.prerelease && typeof r.tag_name === 'string')
    .map((r) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(r.tag_name))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])
  return versions[0]?.join('.')
}

export async function stableVersion(): Promise<string | undefined> {
  const r = await fetch('https://api.github.com/repos/elrincondeisma/cartero/releases?per_page=30', {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'cartero-aws' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  return r?.ok ? pickLatestVersion(await r.json()) : undefined
}

/**
 * La imagen a desplegar: `:stable` (se actualiza desde la app) o una versión fijada.
 * Devuelve también la versión que hay detrás, solo para enseñarla.
 */
export async function resolveImage(tag: string): Promise<{ image: string; version?: string }> {
  if (!(await imageTagExists(tag))) throw new Error(`No existe la imagen ${CARTERO_IMAGE}:${tag}`)
  return { image: `${CARTERO_IMAGE}:${tag}`, version: tag === 'stable' ? await stableVersion() : tag }
}
