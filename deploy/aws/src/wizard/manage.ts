/** Despliegues guardados: actualizar a la última imagen, ver el estado o destruir. */
import { resolveImage, stackInfo } from '../aws/discover.js'
import type { Session } from '../aws/session.js'
import { type DeployConfig, imageChannel } from '../config.js'
import {
  deploy,
  destroy,
  reapplyEc2,
  redeployFargate,
  STATE_DIR,
  snapshotEc2,
  waitHealthy,
} from '../deploy.js'
import { m } from '../i18n.js'
import { ask, p, withSpinner } from './ask.js'
import { askTag } from './build.js'
import { keptOnDestroy } from './summary.js'

export async function status(s: Session, c: DeployConfig): Promise<void> {
  const info = await withSpinner(
    m.statusLooking,
    () => stackInfo(s, c.stackName),
    (i) => (i ? i.status : m.statusMissing),
  )
  if (!info) return
  const url = info.outputs.Url
  const lines = Object.entries(info.outputs).map(([k, v]) => `${k.padEnd(16)} ${v}`)
  if (url) {
    const ok = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10_000) })
      .then((r) => r.ok)
      .catch(() => false)
    lines.unshift(`${m.statusHealth.padEnd(16)} ${ok ? `✔ ${m.statusUp}` : `✘ ${m.statusDown}`}`, '')
  }
  p.note(lines.join('\n'), c.stackName)
}

export async function update(s: Session, c: DeployConfig): Promise<void> {
  const current = imageChannel(c.image)
  // Los despliegues de antes fijaban la imagen por digest: pasan a stable
  if (current === 'pinned') p.log.info(m.updateLegacy)
  const tag = await askTag(current === 'pinned' ? 'stable' : current)
  const { image } = await withSpinner(
    m.imageLooking,
    () => resolveImage(tag),
    (i) => m.imageFound(tag, i.version),
  )
  if (image === c.image && tag !== 'stable') p.log.info(m.updateSame)
  if (!(await ask(p.confirm({ message: m.updateConfirm(c.stackName) })))) return
  const next = { ...c, image }
  const outputs = await deploy(s, next)
  if (next.compute === 'fargate' && tag === 'stable')
    await withSpinner(
      m.updateRedeploying,
      () => redeployFargate(s, next.stackName),
      () => m.updateRedeployed,
    )
  if (next.compute === 'ec2' && outputs.InstanceId) {
    const r = await withSpinner(
      m.updateApplying,
      () => reapplyEc2(s, outputs.InstanceId),
      (x) => (x.ok ? m.updateApplied : m.updateApplyFailed),
    )
    if (!r.ok) p.log.error(r.output)
  }
  await finish(outputs)
}

export async function remove(s: Session, c: DeployConfig): Promise<void> {
  p.note(
    keptOnDestroy(c)
      .map((k) => `· ${k}`)
      .join('\n'),
    m.destroyKept,
  )
  const typed = await ask(p.text({ message: m.destroyType(c.stackName) }))
  if (typed !== c.stackName) {
    p.log.warn(m.destroyAborted)
    return
  }
  if (c.compute === 'ec2' && c.database.mode === 'container') {
    const info = await stackInfo(s, c.stackName)
    const id = info?.outputs.InstanceId
    if (id && (await ask(p.confirm({ message: m.destroySnapshot, initialValue: true })))) {
      await withSpinner(
        m.destroySnapshotting,
        () => snapshotEc2(s, id, c.stackName),
        (snap) => m.destroySnapshotDone(snap ?? '—'),
      )
    }
  }
  await destroy(s, c)
  p.log.success(m.destroyDone(c.stackName))
  p.log.info(m.destroyCleanup(c.stackName, c.region))
}

/** Tras desplegar: espera a que responda y enseña la dirección. */
export async function finish(outputs: Record<string, string>): Promise<void> {
  const url = outputs.Url
  if (!url) return
  const s = p.spinner()
  s.start(m.waitHealthy(url))
  const ok = await waitHealthy(url, 15 * 60_000, (n) => s.message(`${m.waitHealthy(url)} (${n})`))
  if (ok) s.stop(m.healthyOk)
  else s.error(m.healthyTimeout)
  p.note(
    [
      `${m.outUrl.padEnd(14)} ${url}`,
      `${m.outSetup.padEnd(14)} ${outputs.SetupUrl ?? `${url}/setup`}`,
      '',
      m.outSecretKey(outputs.SecretKeyArn ?? ''),
      outputs.InstanceId
        ? m.outSsm(outputs.InstanceId)
        : outputs.LogGroupName
          ? m.outLogs(outputs.LogGroupName)
          : '',
      m.outSaved(STATE_DIR),
    ]
      .filter((l) => l !== undefined)
      .join('\n'),
    m.outTitle,
  )
}
