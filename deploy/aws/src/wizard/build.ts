/**
 * Pasos 2–8: construye el DeployConfig recurso a recurso. En modo recomendado no pregunta lo que
 * tiene una respuesta clara (red nueva, RDS y Valkey nuevos o, en EC2, todo dentro de la máquina).
 * Las contraseñas que teclea el usuario se quedan en `pending` y solo se guardan en Secrets Manager
 * después de confirmar el resumen.
 */
import {
  cacheInVpc,
  cloudfrontPrefixList,
  findCertificates,
  latestImage,
  listCaches,
  listPostgres,
  listVpcs,
  listZones,
  onePerAz,
  twoAzs,
  type VpcInfo,
  vpcRoom,
} from '../aws/discover.js'
import type { Identity, Session } from '../aws/session.js'
import type { CacheConfig, DatabaseConfig, DeployConfig, DomainConfig, NetworkConfig } from '../config.js'
import { m } from '../i18n.js'
import { ask, p, withSpinner } from './ask.js'

export interface Pending {
  db?: { username: string; password: string }
  redisPassword?: string
}

export interface Draft {
  config: DeployConfig
  pending: Pending
}

const STACK_RE = /^[A-Za-z][A-Za-z0-9-]{0,127}$/

/** Fargate necesita subredes públicas en dos zonas (el ALB lo exige); la EC2, una. */
export function eligibleVpc(v: VpcInfo, compute: 'fargate' | 'ec2'): boolean {
  const azs = new Set(v.subnets.filter((s) => s.public).map((s) => s.az))
  return azs.size >= (compute === 'fargate' ? 2 : 1)
}

/** Subredes para la red existente: públicas (una por zona) y, para RDS/Redis, privadas si hay dos zonas. */
export function pickSubnets(v: VpcInfo): {
  publicSubnets: { id: string; az: string }[]
  privateSubnets: { id: string; az: string }[]
} {
  const strip = (s: { id: string; az: string }) => ({ id: s.id, az: s.az })
  const pub = onePerAz(v.subnets.filter((s) => s.public)).map(strip)
  const priv = onePerAz(v.subnets.filter((s) => !s.public)).map(strip)
  return { publicSubnets: pub, privateSubnets: priv.length >= 2 ? priv : onePerAz(v.subnets).map(strip) }
}

export async function buildConfig(session: Session, identity: Identity, taken: string[]): Promise<Draft> {
  const pending: Pending = {}

  const mode = await ask(
    p.select({
      message: m.mode,
      options: [
        { value: 'recommended' as const, label: m.modeRecommended, hint: m.modeRecommendedHint },
        { value: 'custom' as const, label: m.modeCustom, hint: m.modeCustomHint },
      ],
    }),
  )
  const custom = mode === 'custom'

  const stackName = await ask(
    p.text({
      message: m.stackName,
      defaultValue: taken.includes('Cartero') ? 'Cartero2' : 'Cartero',
      placeholder: taken.includes('Cartero') ? 'Cartero2' : 'Cartero',
      validate: (v) => {
        const name = v || (taken.includes('Cartero') ? 'Cartero2' : 'Cartero')
        if (!STACK_RE.test(name)) return m.stackNameBad
        if (taken.includes(name)) return m.stackNameTaken
        return undefined
      },
    }),
  )

  // ─── Cómputo ───
  const compute = await ask(
    p.select({
      message: m.compute,
      options: [
        { value: 'fargate' as const, label: m.computeFargate, hint: m.computeFargateHint },
        { value: 'ec2' as const, label: m.computeEc2, hint: m.computeEc2Hint },
      ],
    }),
  )

  // ─── Red ───
  let network: NetworkConfig = { mode: 'new' }
  let vpc: VpcInfo | undefined
  if (custom) {
    const vpcs = (
      await withSpinner(
        m.netLooking,
        () => listVpcs(session),
        (v) => m.netFound(v.length),
      )
    ).filter((v) => eligibleVpc(v, compute))
    const choice = await ask(
      p.select({
        message: m.network,
        options: [
          { value: 'new', label: m.netNew, hint: m.netNewHint },
          ...vpcs.map((v) => ({
            value: v.id,
            label: `${v.name ?? v.id}${v.isDefault ? ` (${m.netDefault})` : ''}`,
            hint: m.netVpcHint(
              v.cidr,
              v.subnets.filter((s) => s.public).length,
              v.subnets.filter((s) => !s.public).length,
            ),
          })),
        ],
      }),
    )
    if (choice !== 'new') {
      vpc = vpcs.find((v) => v.id === choice)
      if (vpc) network = { mode: 'existing', vpcId: vpc.id, ...pickSubnets(vpc) }
    }
  }

  if (network.mode === 'new') {
    // Sin hueco para otra VPC, CloudFormation fallaría a mitad de despliegue: mejor avisar ahora
    const room = await vpcRoom(session).catch(() => undefined)
    if (room && room.used >= room.limit) {
      p.log.error(m.vpcLimit(room.used, room.limit))
      process.exit(1)
    }
    network = { mode: 'new', azs: await twoAzs(session) }
  }

  // ─── Base de datos ───
  let database: DatabaseConfig = compute === 'ec2' && !custom ? { mode: 'container' } : { mode: 'new' }
  let sgIngress = false
  if (custom) {
    if (!vpc) p.log.info(m.existingNeedsVpc)
    const dbs = vpc
      ? (
          await withSpinner(
            m.dbLooking,
            () => listPostgres(session),
            (d) => m.dbFound(d.length),
          )
        ).filter((d) => d.vpcId === vpc?.id)
      : []
    const choice = await ask(
      p.select({
        message: m.database,
        initialValue: compute === 'ec2' ? 'container' : 'new',
        options: [
          { value: 'new', label: m.dbNew, hint: m.dbNewHint },
          ...(compute === 'ec2'
            ? [{ value: 'container', label: m.dbContainer, hint: m.dbContainerHint }]
            : []),
          ...dbs.map((d) => ({ value: d.id, label: d.id, hint: `${d.engine} ${d.version} · ${d.host}` })),
        ],
      }),
    )
    if (choice === 'container') database = { mode: 'container' }
    else if (choice !== 'new') {
      const d = dbs.find((x) => x.id === choice)
      if (d) {
        const name = await ask(
          p.text({
            message: m.dbName,
            defaultValue: d.dbName ?? 'cartero',
            placeholder: d.dbName ?? 'cartero',
          }),
        )
        let secretArn = ''
        const useManaged = d.masterSecretArn
          ? await ask(p.confirm({ message: m.dbUseManaged(d.masterUser ?? '') }))
          : false
        if (useManaged && d.masterSecretArn) secretArn = d.masterSecretArn
        else {
          const username = await ask(
            p.text({
              message: m.dbUser,
              defaultValue: d.masterUser,
              placeholder: d.masterUser,
              validate: (v) => (v || d.masterUser ? undefined : m.required),
            }),
          )
          const password = await ask(
            p.password({ message: m.dbPassword, validate: (v) => (v ? undefined : m.required) }),
          )
          pending.db = { username: username || d.masterUser || '', password }
        }
        const ssl = await ask(p.confirm({ message: m.dbSsl, initialValue: true }))
        let securityGroupId = d.securityGroupId
        if (securityGroupId) {
          sgIngress = await ask(p.confirm({ message: m.sgIngress(securityGroupId, d.port) }))
          if (!sgIngress) {
            p.log.warn(m.sgManual(securityGroupId, d.port))
            securityGroupId = undefined
          }
        }
        database = {
          mode: 'existing',
          host: d.host,
          port: d.port,
          name: name || d.dbName || 'cartero',
          secretArn,
          securityGroupId,
          ssl,
        }
      }
    }
  }

  // ─── Redis ───
  let cache: CacheConfig = compute === 'ec2' && !custom ? { mode: 'container' } : { mode: 'new' }
  if (custom) {
    const caches = vpc
      ? (
          await withSpinner(
            m.cacheLooking,
            () => listCaches(session),
            (c) => m.cacheFound(c.length),
          )
        ).filter((c) => (vpc ? cacheInVpc(c, vpc) : false))
      : []
    const choice = await ask(
      p.select({
        message: m.cache,
        initialValue: compute === 'ec2' ? 'container' : 'new',
        options: [
          { value: 'new', label: m.cacheNew, hint: m.cacheNewHint },
          ...(compute === 'ec2'
            ? [{ value: 'container', label: m.cacheContainer, hint: m.cacheContainerHint }]
            : []),
          ...caches.map((c) => ({
            value: c.id,
            label: c.id,
            hint: `${c.engine} · ${c.kind} · ${c.host}${c.tls ? ' · TLS' : ''}`,
          })),
        ],
      }),
    )
    if (choice === 'container') cache = { mode: 'container' }
    else if (choice !== 'new') {
      const c = caches.find((x) => x.id === choice)
      if (c) {
        if (c.auth)
          pending.redisPassword = await ask(
            p.password({ message: m.cachePassword, validate: (v) => (v ? undefined : m.required) }),
          )
        let securityGroupId = c.securityGroupId
        if (securityGroupId) {
          const ok = await ask(p.confirm({ message: m.sgIngress(securityGroupId, c.port) }))
          sgIngress ||= ok
          if (!ok) {
            p.log.warn(m.sgManual(securityGroupId, c.port))
            securityGroupId = undefined
          }
        }
        cache = { mode: 'existing', host: c.host, port: c.port, tls: c.tls, securityGroupId }
      }
    }
  }

  // ─── Dominio ───
  let domain: DomainConfig = { mode: 'none' }
  const zones = await listZones(session).catch(() => [])
  if (zones.length) {
    const choice = await ask(
      p.select({
        message: m.domain,
        options: [
          {
            value: 'none',
            label: m.domainNone,
            hint: compute === 'fargate' ? m.domainNoneFargate : m.domainNoneEc2,
          },
          ...zones.map((z) => ({ value: z.id, label: z.name, hint: 'Route 53' })),
        ],
      }),
    )
    const zone = zones.find((z) => z.id === choice)
    if (zone) {
      const recordName =
        (
          await ask(
            p.text({
              message: m.domainRecord,
              defaultValue: `cartero.${zone.name}`,
              placeholder: `cartero.${zone.name}`,
              validate: (v) => {
                const n = (v || `cartero.${zone.name}`).toLowerCase()
                return n === zone.name || n.endsWith(`.${zone.name}`)
                  ? undefined
                  : m.domainRecordBad(zone.name)
              },
            }),
          )
        ).toLowerCase() || `cartero.${zone.name}`
      let certificateArn: string | undefined
      if (compute === 'fargate') {
        const certs = await withSpinner(
          m.certLooking,
          () => findCertificates(session, recordName),
          (c) => m.certFound(c.length),
        )
        if (certs.length) {
          const pick = await ask(
            p.select({
              message: m.cert,
              options: [
                ...certs.map((c) => ({ value: c.arn, label: c.domain, hint: c.arn.split('/').pop() })),
                { value: 'new', label: m.certNew, hint: m.certNewHint },
              ],
            }),
          )
          if (pick !== 'new') certificateArn = pick
        }
      }
      domain = { mode: 'route53', zoneId: zone.id, zoneName: zone.name, recordName, certificateArn }
    }
  } else {
    p.log.info(compute === 'fargate' ? m.domainNoZonesFargate : m.domainNoZonesEc2)
  }

  // ─── Administración ───
  const emailsRaw = await ask(
    p.text({
      message: m.adminEmails,
      placeholder: 'tu@empresa.com',
      validate: (v) => {
        const list = splitEmails(v ?? '')
        return list.every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) ? undefined : m.adminEmailsBad
      },
    }),
  )
  const allowRegistration = await ask(p.confirm({ message: m.allowRegistration, initialValue: false }))

  const tag = custom
    ? (await ask(p.text({ message: m.imageTag, defaultValue: 'latest', placeholder: 'latest' }))) || 'latest'
    : 'latest'
  const image = await withSpinner(
    m.imageLooking,
    () => latestImage(tag),
    (i) => m.imageFound(i.split('@')[1]?.slice(0, 19) ?? ''),
  )

  const cloudfrontPrefixListId =
    compute === 'fargate' && domain.mode === 'none'
      ? await cloudfrontPrefixList(session).catch(() => undefined)
      : undefined

  return {
    pending,
    config: {
      version: 1,
      stackName: stackName || (taken.includes('Cartero') ? 'Cartero2' : 'Cartero'),
      account: identity.account,
      region: session.region,
      compute,
      image,
      network,
      database,
      cache,
      domain,
      admin: { emails: splitEmails(emailsRaw ?? ''), allowRegistration },
      allowExistingSgIngress: sgIngress,
      cloudfrontPrefixListId,
    },
  }
}

export const splitEmails = (v: string) =>
  v
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean)
