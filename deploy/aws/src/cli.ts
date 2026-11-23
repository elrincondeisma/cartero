#!/usr/bin/env node
/**
 * Asistente para desplegar Cartero en AWS.
 *
 *   cartero-aws                         asistente paso a paso
 *   cartero-aws deploy  --config <f>    despliega o actualiza sin preguntas (CI)
 *   cartero-aws status  --config <f>    estado y salud
 *   cartero-aws destroy --config <f> --yes
 *
 * Opciones: --lang es|en, --profile <perfil> (sin preguntas; si no, credenciales del entorno).
 */
import { parseArgs } from 'node:util'
import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createDbSecret, createRedisSecret, stackInfo } from './aws/discover.js'
import type { Session } from './aws/session.js'
import { type DeployConfig, imageChannel, loadConfig, savedConfigs, validateConfig } from './config.js'
import { bootstrap, deploy, destroy, reapplyEc2, redeployFargate, STATE_DIR, waitHealthy } from './deploy.js'
import { detectLang, m, setLang } from './i18n.js'
import { ask, p, withSpinner } from './wizard/ask.js'
import { buildConfig, type Pending } from './wizard/build.js'
import { askCredentials, askRegion } from './wizard/credentials.js'
import { finish, remove, status, update } from './wizard/manage.js'
import { summaryText } from './wizard/summary.js'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    lang: { type: 'string' },
    config: { type: 'string' },
    profile: { type: 'string' },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

setLang(values.lang === 'en' || values.lang === 'es' ? values.lang : detectLang())

async function interactive(): Promise<void> {
  p.intro(m.title)
  p.note(m.welcome, m.welcomeTitle)

  const { session: base, identity } = await askCredentials()
  const { session, bootstrapped } = await askRegion(base)

  const saved = savedConfigs(STATE_DIR).filter(
    (c) => c.account === identity.account && c.region === session.region,
  )
  if (saved.length) {
    const action = await ask(
      p.select({
        message: m.savedFound(saved.length),
        options: [
          { value: 'new', label: m.actionNew },
          ...saved.flatMap((c) => [
            { value: `update:${c.stackName}`, label: m.actionUpdate(c.stackName), hint: c.compute },
            { value: `status:${c.stackName}`, label: m.actionStatus(c.stackName) },
            { value: `destroy:${c.stackName}`, label: m.actionDestroy(c.stackName) },
          ]),
        ],
      }),
    )
    if (action !== 'new') {
      const [verb, name] = action.split(':')
      const c = saved.find((x) => x.stackName === name) as DeployConfig
      if (verb === 'update') await update(session, c)
      else if (verb === 'status') await status(session, c)
      else await remove(session, c)
      p.outro(m.bye)
      return
    }
  }

  const { config, pending } = await buildConfig(
    session,
    identity,
    saved.map((c) => c.stackName),
  )
  p.note(summaryText(config), m.sumTitle)
  if (!bootstrapped) p.log.info(m.cdkWillBootstrap)
  if (!(await ask(p.confirm({ message: m.confirmDeploy, initialValue: false })))) {
    p.cancel(m.cancelled)
    return
  }

  await storePending(session, config, pending)
  const errors = validateConfig(config)
  if (errors.length) throw new Error(errors.join('\n'))
  if (!bootstrapped && (await bootstrap(session, identity.account)) !== 0)
    throw new Error(m.cdkBootstrapFailed)

  p.log.step(m.deploying)
  const outputs = await deploy(session, config)
  await finish(outputs)
  p.outro(m.bye)
}

/** Guarda en Secrets Manager las credenciales tecleadas (solo después de confirmar). */
async function storePending(s: Session, c: DeployConfig, pending: Pending): Promise<void> {
  if (pending.db && c.database.mode === 'existing') {
    const { username, password } = pending.db
    c.database.secretArn = await withSpinner(m.secretCreating, () =>
      createDbSecret(s, c.stackName, username, password),
    )
  }
  if (pending.redisPassword && c.cache.mode === 'existing') {
    const pw = pending.redisPassword
    c.cache.authSecretArn = await withSpinner(m.secretCreating, () => createRedisSecret(s, c.stackName, pw))
  }
}

/** Sin preguntas: credenciales del perfil indicado o de la cadena por defecto (entorno, SSO, rol…). */
function envSession(region: string): Session {
  if (values.profile)
    return {
      kind: 'profile',
      profile: values.profile,
      region,
      credentials: fromIni({ profile: values.profile }),
    }
  return { kind: 'env', region, credentials: fromNodeProviderChain() }
}

async function scripted(cmd: string): Promise<void> {
  if (!values.config) throw new Error('--config <cartero-aws.<stack>.json>')
  const c = loadConfig(values.config)
  const errors = validateConfig(c)
  if (errors.length) throw new Error(errors.join('\n'))
  const s = envSession(c.region)
  if (cmd === 'deploy') {
    const existed = !!(await stackInfo(s, c.stackName))
    const outputs = await deploy(s, c)
    // Con :stable la plantilla no cambia al salir una versión: se trae a mano
    if (existed && imageChannel(c.image) === 'stable') {
      if (c.compute === 'fargate') await redeployFargate(s, c.stackName)
      else if (outputs.InstanceId) {
        const r = await reapplyEc2(s, outputs.InstanceId)
        if (!r.ok) throw new Error(r.output)
      }
    }
    console.log(JSON.stringify(outputs, null, 2))
    if (outputs.Url && !(await waitHealthy(outputs.Url))) throw new Error(m.healthyTimeout)
    console.log(m.healthyOk)
  } else if (cmd === 'status') {
    console.log(JSON.stringify(await stackInfo(s, c.stackName), null, 2))
  } else if (cmd === 'destroy') {
    if (!values.yes) throw new Error('destroy necesita --yes')
    await destroy(s, c)
  } else throw new Error(`Comando desconocido: ${cmd}`)
}

const HELP = `cartero-aws [deploy|status|destroy] [--config f] [--profile p] [--lang es|en] [--yes]`

try {
  if (values.help) console.log(HELP)
  else if (positionals[0]) await scripted(positionals[0])
  else await interactive()
} catch (err) {
  p.log.error((err as Error).message)
  process.exit(1)
}
