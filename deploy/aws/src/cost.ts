/**
 * Estimación mensual aproximada en USD (precios bajo demanda de us-east-1 / eu-west-1, tráfico
 * bajo). Sirve para comparar opciones en el resumen, no es una factura: cada región cambia un poco.
 */
import type { DeployConfig } from './config.js'

export type CostKey =
  | 'fargate'
  | 'alb'
  | 'publicIps'
  | 'cloudfront'
  | 'efs'
  | 'rds'
  | 'elasticache'
  | 'ec2'
  | 'ebs'
  | 'eip'
  | 'secrets'
  | 'logs'

export interface CostLine {
  key: CostKey
  usd: number
}

const HOURS = 730
const PRICE = {
  fargateVcpu: 0.04048,
  fargateGb: 0.004445,
  alb: 0.0225 * HOURS + 6, // hora + unos pocos LCU
  ipv4: 0.005 * HOURS,
  cloudfront: 1,
  efs: 1,
  rdsMicro: 0.016 * HOURS + 20 * 0.115,
  cacheMicro: 0.016 * HOURS,
  t3small: 0.0208 * HOURS,
  ebsGb: 0.08,
  secret: 0.4,
  logs: 1,
}

export function estimateCost(c: DeployConfig): CostLine[] {
  const lines: CostLine[] = []
  const add = (key: CostKey, usd: number) => lines.push({ key, usd: Math.round(usd * 100) / 100 })
  let secrets = 1 // CARTERO_SECRET_KEY

  if (c.compute === 'fargate') {
    add('fargate', (0.5 * PRICE.fargateVcpu + 1 * PRICE.fargateGb) * HOURS)
    add('alb', PRICE.alb)
    // Dos IP públicas del ALB (una por zona) y la de la tarea
    add('publicIps', 3 * PRICE.ipv4)
    if (c.domain.mode === 'none') add('cloudfront', PRICE.cloudfront)
    add('efs', PRICE.efs)
  } else {
    add('ec2', PRICE.t3small)
    add('ebs', 30 * PRICE.ebsGb)
    add('eip', PRICE.ipv4)
  }
  if (c.database.mode === 'new') {
    add('rds', PRICE.rdsMicro)
    secrets++
  }
  if (c.database.mode === 'container') secrets++
  if (c.cache.mode === 'new') add('elasticache', PRICE.cacheMicro)
  add('secrets', secrets * PRICE.secret)
  // En la EC2 los logs se quedan en la máquina (docker compose logs)
  if (c.compute === 'fargate') add('logs', PRICE.logs)
  return lines
}

export const totalCost = (lines: CostLine[]) => Math.round(lines.reduce((a, l) => a + l.usd, 0))
