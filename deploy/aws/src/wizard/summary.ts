/** Paso 9: qué se reutiliza, qué se crea, cuánto cuesta y qué se conserva al destruir. */
import type { DeployConfig } from '../config.js'
import { estimateCost, totalCost } from '../cost.js'
import { m } from '../i18n.js'

export function summaryText(c: DeployConfig): string {
  const lines: string[] = []
  const row = (k: string, v: string) => lines.push(`${k.padEnd(16)} ${v}`)
  row(m.sumAccount, `${c.account} · ${c.region}`)
  row(m.sumStack, c.stackName)
  row(m.sumCompute, c.compute === 'fargate' ? m.sumFargate : m.sumEc2)
  row(m.sumNetwork, c.network.mode === 'new' ? m.sumNew(m.sumVpcNew) : m.sumExisting(c.network.vpcId))
  row(
    m.sumDatabase,
    c.database.mode === 'new'
      ? m.sumNew('RDS Postgres 17 · db.t4g.micro')
      : c.database.mode === 'container'
        ? m.sumInside('Postgres 17')
        : m.sumExisting(c.database.host),
  )
  row(
    m.sumCache,
    c.cache.mode === 'new'
      ? m.sumNew('ElastiCache Valkey · cache.t4g.micro')
      : c.cache.mode === 'container'
        ? m.sumInside('Redis 7')
        : m.sumExisting(c.cache.host),
  )
  row(
    m.sumUrl,
    c.domain.mode === 'route53'
      ? `https://${c.domain.recordName}${c.compute === 'fargate' ? ` (${c.domain.certificateArn ? m.sumCertExisting : m.sumCertNew})` : ' (Let’s Encrypt)'}`
      : c.compute === 'fargate'
        ? 'https://xxxx.cloudfront.net'
        : 'https://<ip>.sslip.io (Let’s Encrypt)',
  )
  row(m.sumAdmins, c.admin.emails.join(', ') || m.sumAdminsSetup)
  row(m.sumRegistration, c.admin.allowRegistration ? m.yes : m.no)
  row(m.sumImage, c.image.replace(/@sha256:(.{12}).*/, '@sha256:$1…'))

  const cost = estimateCost(c)
  lines.push('', m.sumCost(totalCost(cost)))
  for (const l of cost) lines.push(`  ${m.costLabel[l.key].padEnd(30)} ${`$${l.usd.toFixed(2)}`.padStart(8)}`)
  lines.push('', m.sumKept)
  for (const k of keptOnDestroy(c)) lines.push(`  · ${k}`)
  return lines.join('\n')
}

/** Lo que sobrevive a «Destruir» a propósito (para no perder datos). */
export function keptOnDestroy(c: DeployConfig): string[] {
  const out = [m.keptSecretKey]
  if (c.database.mode === 'new') out.push(m.keptRdsSnapshot)
  if (c.database.mode === 'container') out.push(m.keptContainerPassword, m.keptEbsSnapshot)
  if (c.compute === 'fargate') out.push(m.keptEfs)
  if (c.database.mode === 'existing' || c.cache.mode === 'existing') out.push(m.keptExisting)
  return out
}
