/**
 * Lo que decide el asistente. Se guarda en `cartero-aws.<stack>.json` para poder actualizar o
 * destruir más tarde, y la app de CDK lo lee para crear el stack. Nunca lleva secretos: las
 * contraseñas viven en Secrets Manager y aquí solo van sus ARN.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CARTERO_IMAGE = 'ghcr.io/elrincondeisma/cartero'

export interface SubnetRef {
  id: string
  az: string
}

export type NetworkConfig =
  | {
      mode: 'new'
      /** Dos zonas de la región (las elige el asistente; así CDK no necesita buscarlas en la cuenta) */
      azs?: string[]
    }
  | {
      mode: 'existing'
      vpcId: string
      /** Subredes con salida a Internet (ALB, tareas o la EC2): al menos dos zonas para Fargate */
      publicSubnets: SubnetRef[]
      /** Subredes para RDS y Redis nuevos (privadas o aisladas); si no hay, se usan las públicas */
      privateSubnets: SubnetRef[]
    }

export type DatabaseConfig =
  | { mode: 'new' }
  /** Solo en EC2: Postgres en un contenedor de la propia máquina */
  | { mode: 'container' }
  | {
      mode: 'existing'
      host: string
      port: number
      name: string
      /** Secreto con `username` y `password` (el que gestiona RDS o uno que crea el asistente) */
      secretArn: string
      /** Grupo de seguridad de la base de datos, para abrirle el puerto a Cartero */
      securityGroupId?: string
      ssl: boolean
    }

export type CacheConfig =
  | { mode: 'new' }
  | { mode: 'container' }
  | {
      mode: 'existing'
      host: string
      port: number
      tls: boolean
      /** Secreto con la contraseña de Redis (campo `password`), si la tiene */
      authSecretArn?: string
      securityGroupId?: string
    }

export type DomainConfig =
  | { mode: 'none' }
  | {
      mode: 'route53'
      zoneId: string
      zoneName: string
      /** Nombre completo, p. ej. cartero.midominio.com */
      recordName: string
      /** Certificado de ACM existente en la región (Fargate); si no hay, se crea uno validado por DNS */
      certificateArn?: string
    }

export interface DeployConfig {
  version: 1
  stackName: string
  account: string
  region: string
  compute: 'fargate' | 'ec2'
  /** Imagen fijada por digest: ghcr.io/elrincondeisma/cartero@sha256:… */
  image: string
  network: NetworkConfig
  database: DatabaseConfig
  cache: CacheConfig
  domain: DomainConfig
  admin: { emails: string[]; allowRegistration: boolean }
  /** El usuario permite añadir reglas de entrada a grupos de seguridad que ya existían */
  allowExistingSgIngress: boolean
  /** Lista de prefijos de CloudFront (origin-facing) en la región, para cerrar el ALB al resto */
  cloudfrontPrefixListId?: string
}

export const configFile = (dir: string, stackName: string) => join(dir, `cartero-aws.${stackName}.json`)

/** Campos que nunca pueden estar en el fichero (comprobación de seguridad al guardar). */
const FORBIDDEN = /password|secretAccessKey|sessionToken|accessKeyId|secretKey/i

export function assertNoSecrets(value: unknown, path = ''): void {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.test(k)) throw new Error(`La configuración no puede llevar secretos (${path}${k})`)
      assertNoSecrets(v, `${path}${k}.`)
    }
  }
}

export function saveConfig(dir: string, config: DeployConfig): string {
  assertNoSecrets(config)
  const file = configFile(dir, config.stackName)
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
  return file
}

export function loadConfig(file: string): DeployConfig {
  const c = JSON.parse(readFileSync(file, 'utf8')) as DeployConfig
  if (c.version !== 1) throw new Error(`Versión de configuración no soportada: ${c.version}`)
  return c
}

/** Despliegues guardados en una carpeta (para ofrecer actualizar, ver estado o destruir). */
export function savedConfigs(dir: string): DeployConfig[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^cartero-aws\..+\.json$/.test(f))
    .map((f) => {
      try {
        return loadConfig(join(dir, f))
      } catch {
        return null
      }
    })
    .filter((c): c is DeployConfig => c !== null)
}

/** Combinaciones que no tienen sentido (el asistente no las ofrece, pero la app de CDK lo comprueba). */
export function validateConfig(c: DeployConfig): string[] {
  const errors: string[] = []
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(c.stackName)) errors.push('stackName: letras, números y guiones')
  if (!c.image.startsWith(`${CARTERO_IMAGE}`)) errors.push('image: debe ser la imagen de Cartero')
  if (c.compute === 'fargate' && (c.database.mode === 'container' || c.cache.mode === 'container'))
    errors.push('En Fargate la base de datos y Redis no pueden ir en contenedores de la máquina')
  if (c.network.mode === 'existing') {
    const azs = new Set(c.network.publicSubnets.map((s) => s.az))
    if (c.compute === 'fargate' && azs.size < 2)
      errors.push('Fargate necesita subredes públicas en dos zonas (el ALB lo exige)')
    if (c.network.publicSubnets.length === 0) errors.push('Hace falta al menos una subred pública')
  }
  if (
    (c.database.mode === 'existing' && c.database.securityGroupId) ||
    (c.cache.mode === 'existing' && c.cache.securityGroupId)
  ) {
    if (!c.allowExistingSgIngress)
      errors.push('Para abrir el grupo de seguridad existente hace falta permiso (allowExistingSgIngress)')
  }
  for (const e of c.admin.emails)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) errors.push(`Email no válido: ${e}`)
  return errors
}
