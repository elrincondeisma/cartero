/**
 * Lanza el CLI de CDK (el del propio paquete) con las credenciales de la sesión en el entorno del
 * proceso hijo, y lo que hace falta alrededor: esperar a que Cartero responda, reaplicar la
 * configuración en la EC2 y hacer una snapshot del disco antes de destruir.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CloudFormationClient, DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation'
import {
  CreateSnapshotCommand,
  DeleteSecurityGroupCommand,
  DeleteVpcEndpointsCommand,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcEndpointsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2'
import { ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs'
import { GetCommandInvocationCommand, SendCommandCommand, SSMClient } from '@aws-sdk/client-ssm'
import { childEnv, type Session } from './aws/session.js'
import { configFile, type DeployConfig, saveConfig } from './config.js'
import { m } from './i18n.js'

/** Carpeta del paquete (donde están cdk.json y dist/app.js). */
export const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Dónde se guardan los despliegues (sin secretos). */
export const STATE_DIR = process.env.CARTERO_AWS_HOME ?? join(homedir(), '.config', 'cartero-aws')

export function ensureStateDir(): string {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  return STATE_DIR
}

const outputsFile = (stackName: string) => join(STATE_DIR, `cartero-aws.${stackName}.outputs.json`)

function cdkBin(): string {
  const pkg = createRequire(import.meta.url).resolve('aws-cdk/package.json')
  return join(dirname(pkg), 'bin', 'cdk')
}

/** Ejecuta `cdk <args>` mostrando su salida. Resuelve con el código de salida. */
export function runCdk(s: Session, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cdkBin(), ...args, '--no-notices', '--no-version-reporting'], {
      cwd: PACKAGE_DIR,
      env: { ...childEnv(s), CDK_DISABLE_CLI_TELEMETRY: 'true' },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

export const bootstrap = (s: Session, account: string) =>
  runCdk(s, ['bootstrap', `aws://${account}/${s.region}`])

/** Guarda la configuración y despliega. Devuelve las salidas del stack. */
export async function deploy(s: Session, c: DeployConfig): Promise<Record<string, string>> {
  ensureStateDir()
  const file = saveConfig(STATE_DIR, c)
  const code = await runCdk(s, [
    'deploy',
    c.stackName,
    '-c',
    `config=${file}`,
    // Una carpeta por stack: se pueden desplegar varios a la vez
    '--output',
    join('cdk.out', c.stackName),
    '--require-approval',
    'never',
    '--outputs-file',
    outputsFile(c.stackName),
    '--progress',
    'events',
  ])
  if (code !== 0) {
    // Si el rollback se atasca por el endpoint de GuardDuty, quitarlo deja la VPC lista para borrar
    if (c.network.mode === 'new' && (await removeGuardDutyEndpoint(s, c.stackName).catch(() => 0)) > 0)
      throw new Error(m.deployFailedGuardDuty(c.stackName))
    throw new Error(m.deployFailed(code))
  }
  const all = JSON.parse(readFileSync(outputsFile(c.stackName), 'utf8')) as Record<
    string,
    Record<string, string>
  >
  return all[c.stackName] ?? {}
}

export async function destroy(s: Session, c: DeployConfig): Promise<void> {
  if (c.network.mode === 'new') await removeGuardDutyEndpoint(s, c.stackName)
  const code = await runCdk(s, [
    'destroy',
    c.stackName,
    '-c',
    `config=${configFile(STATE_DIR, c.stackName)}`,
    '--output',
    join('cdk.out', c.stackName),
    '--force',
  ])
  if (code !== 0) throw new Error(m.destroyFailed(code))
  // Ya no hay nada que actualizar: se olvida el despliegue (lo conservado se limpia a mano)
  rmSync(configFile(STATE_DIR, c.stackName), { force: true })
  rmSync(outputsFile(c.stackName), { force: true })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Con GuardDuty Runtime Monitoring, GuardDuty crea por su cuenta un endpoint (guardduty-data) y un
 * grupo de seguridad en la VPC donde corre Cartero. No son del stack y bloquean el borrado de las
 * subredes y la VPC. Solo se llama para la VPC que creó el asistente, nunca para una existente.
 * Devuelve cuántos endpoints ha borrado.
 */
export async function removeGuardDutyEndpoint(s: Session, stackName: string): Promise<number> {
  const opts = { region: s.region, credentials: s.credentials }
  const res = await new CloudFormationClient(opts)
    .send(new DescribeStackResourcesCommand({ StackName: stackName }))
    .catch(() => undefined)
  const vpcId = res?.StackResources?.find((r) => r.ResourceType === 'AWS::EC2::VPC')?.PhysicalResourceId
  if (!vpcId) return 0
  const ec2 = new EC2Client(opts)
  const endpoints = async () =>
    (
      await ec2.send(
        new DescribeVpcEndpointsCommand({
          Filters: [
            { Name: 'vpc-id', Values: [vpcId] },
            { Name: 'service-name', Values: [`com.amazonaws.${s.region}.guardduty-data`] },
          ],
        }),
      )
    ).VpcEndpoints?.filter((e) => String(e.State).toLowerCase() !== 'deleted') ?? []
  const found = await endpoints()
  if (found.length === 0) return 0
  await ec2.send(new DeleteVpcEndpointsCommand({ VpcEndpointIds: found.map((e) => e.VpcEndpointId ?? '') }))
  for (let i = 0; i < 60 && (await endpoints()).length > 0; i++) await sleep(5000)
  // El grupo de seguridad de GuardDuty se puede borrar cuando sus interfaces de red desaparecen
  const sgs = await ec2.send(
    new DescribeSecurityGroupsCommand({
      Filters: [
        { Name: 'vpc-id', Values: [vpcId] },
        { Name: 'group-name', Values: ['GuardDutyManagedSecurityGroup*'] },
      ],
    }),
  )
  for (const sg of sgs.SecurityGroups ?? []) {
    for (let i = 0; i < 24; i++) {
      const ok = await ec2
        .send(new DeleteSecurityGroupCommand({ GroupId: sg.GroupId }))
        .then(() => true)
        .catch(() => false)
      if (ok) break
      await sleep(5000)
    }
  }
  return found.length
}

/** Espera a que /api/health responda 200 (la EC2 tarda unos minutos en instalar Docker y pedir el certificado). */
export async function waitHealthy(
  url: string,
  timeoutMs = 15 * 60_000,
  onTick?: (n: number) => void,
): Promise<boolean> {
  const end = Date.now() + timeoutMs
  for (let n = 1; Date.now() < end; n++) {
    onTick?.(n)
    try {
      const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10_000) })
      if (r.ok) return true
    } catch {
      // aún no
    }
    await new Promise((r) => setTimeout(r, 10_000))
  }
  return false
}

/**
 * En Fargate con `:stable`, la plantilla no cambia al publicarse una versión: hay que pedir a ECS un
 * despliegue nuevo para que vuelva a resolver la etiqueta.
 */
export async function redeployFargate(s: Session, stackName: string): Promise<void> {
  const opts = { region: s.region, credentials: s.credentials }
  const res = await new CloudFormationClient(opts).send(
    new DescribeStackResourcesCommand({ StackName: stackName }),
  )
  const arn = res.StackResources?.find((r) => r.ResourceType === 'AWS::ECS::Service')?.PhysicalResourceId
  if (!arn) throw new Error(`No encuentro el servicio de ECS de ${stackName}`)
  // arn:aws:ecs:<región>:<cuenta>:service/<cluster>/<servicio>
  const cluster = arn.split('/')[1]
  await new ECSClient(opts).send(
    new UpdateServiceCommand({ cluster, service: arn, forceNewDeployment: true }),
  )
}

/** En la EC2, vuelve a lanzar apply.sh (lee la configuración nueva de SSM y reinicia los contenedores). */
export async function reapplyEc2(s: Session, instanceId: string): Promise<{ ok: boolean; output: string }> {
  const ssm = new SSMClient({ region: s.region, credentials: s.credentials })
  const sent = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: 'AWS-RunShellScript',
      Parameters: { commands: ['/opt/cartero/apply.sh'] },
      Comment: 'Cartero: aplicar configuración',
    }),
  )
  const id = sent.Command?.CommandId ?? ''
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    try {
      const r = await ssm.send(new GetCommandInvocationCommand({ CommandId: id, InstanceId: instanceId }))
      if (r.Status === 'Success') return { ok: true, output: r.StandardOutputContent ?? '' }
      if (r.Status && ['Failed', 'Cancelled', 'TimedOut'].includes(r.Status))
        return { ok: false, output: `${r.StandardOutputContent ?? ''}\n${r.StandardErrorContent ?? ''}` }
    } catch {
      // InvocationDoesNotExist justo después de enviarlo
    }
  }
  return { ok: false, output: 'timeout' }
}

/** Snapshot del disco de la EC2 (ahí viven Postgres y los ficheros en el modo «todo dentro»). */
export async function snapshotEc2(
  s: Session,
  instanceId: string,
  stackName: string,
): Promise<string | undefined> {
  const ec2 = new EC2Client({ region: s.region, credentials: s.credentials })
  const r = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }))
  const vol = r.Reservations?.[0]?.Instances?.[0]?.BlockDeviceMappings?.[0]?.Ebs?.VolumeId
  if (!vol) return undefined
  const snap = await ec2.send(
    new CreateSnapshotCommand({
      VolumeId: vol,
      Description: `Cartero ${stackName}: copia antes de destruir`,
      TagSpecifications: [
        {
          ResourceType: 'snapshot',
          Tags: [
            { Key: 'app', Value: 'cartero' },
            { Key: 'cartero:stack', Value: stackName },
          ],
        },
      ],
    }),
  )
  return snap.SnapshotId
}
