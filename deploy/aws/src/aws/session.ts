/**
 * Credenciales: un perfil de ~/.aws (incluidos los de SSO) o una access key pegada. Las claves
 * viven solo en memoria y llegan a CDK por variables de entorno del proceso hijo; nunca se guardan.
 */
import { spawnSync } from 'node:child_process'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'
import { fromIni } from '@aws-sdk/credential-providers'
import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader'
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types'

export interface ProfileInfo {
  name: string
  region?: string
  sso: boolean
}

export type Session =
  | { kind: 'profile'; profile: string; region: string; credentials: AwsCredentialIdentityProvider }
  | { kind: 'keys'; keys: AwsCredentialIdentity; region: string; credentials: AwsCredentialIdentityProvider }
  /** Sin preguntas (CI): la cadena por defecto del SDK; a cdk se le pasa el entorno tal cual */
  | { kind: 'env'; region: string; credentials: AwsCredentialIdentityProvider }

/** Une los perfiles de `config` y `credentials` (un perfil puede estar en los dos). */
export function mergeProfiles(
  config: Record<string, Record<string, string | undefined>>,
  credentials: Record<string, Record<string, string | undefined>>,
): ProfileInfo[] {
  const names = new Set([...Object.keys(config), ...Object.keys(credentials)])
  return [...names]
    .map((name) => {
      const c = config[name] ?? {}
      return { name, region: c.region, sso: Boolean(c.sso_session || c.sso_start_url || c.sso_account_id) }
    })
    .sort((a, b) => (a.name === 'default' ? -1 : b.name === 'default' ? 1 : a.name.localeCompare(b.name)))
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const { configFile, credentialsFile } = await loadSharedConfigFiles()
  return mergeProfiles(configFile, credentialsFile)
}

export function profileSession(profile: string, region: string): Session {
  return { kind: 'profile', profile, region, credentials: fromIni({ profile }) }
}

export function keysSession(keys: AwsCredentialIdentity, region: string): Session {
  return { kind: 'keys', keys, region, credentials: async () => keys }
}

export function withRegion(s: Session, region: string): Session {
  return { ...s, region }
}

export interface Identity {
  account: string
  arn: string
}

export async function whoAmI(s: Session): Promise<Identity> {
  const sts = new STSClient({ region: s.region, credentials: s.credentials })
  const r = await sts.send(new GetCallerIdentityCommand({}))
  return { account: r.Account ?? '', arn: r.Arn ?? '' }
}

/** ¿El error es de una sesión SSO caducada o sin iniciar? */
export function isSsoExpired(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err)
  return /sso|token.*(expired|invalid)|refresh/i.test(msg)
}

/** Lanza `aws sso login` (necesita la AWS CLI). Devuelve si ha ido bien. */
export function ssoLogin(profile: string): boolean {
  const r = spawnSync('aws', ['sso', 'login', '--profile', profile], { stdio: 'inherit' })
  return r.status === 0
}

/** Entorno para los procesos hijos (cdk): solo las credenciales de esta sesión, sin mezclar otras. */
export function childEnv(s: Session): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, AWS_REGION: s.region, AWS_DEFAULT_REGION: s.region }
  if (s.kind === 'env') return env
  for (const k of ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'])
    delete env[k]
  if (s.kind === 'profile') env.AWS_PROFILE = s.profile
  else {
    env.AWS_ACCESS_KEY_ID = s.keys.accessKeyId
    env.AWS_SECRET_ACCESS_KEY = s.keys.secretAccessKey
    if (s.keys.sessionToken) env.AWS_SESSION_TOKEN = s.keys.sessionToken
  }
  return env
}
