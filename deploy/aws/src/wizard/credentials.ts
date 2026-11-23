/** Paso 1: credenciales (lo único que se pide al principio) y región. */
import { cdkBootstrapped, listRegions } from '../aws/discover.js'
import {
  type Identity,
  isSsoExpired,
  keysSession,
  listProfiles,
  profileSession,
  type Session,
  ssoLogin,
  whoAmI,
  withRegion,
} from '../aws/session.js'
import { m } from '../i18n.js'
import { ask, p, withSpinner } from './ask.js'

const FALLBACK_REGION = 'eu-west-1'

export async function askCredentials(): Promise<{ session: Session; identity: Identity }> {
  const profiles = await listProfiles().catch(() => [])
  const method = profiles.length
    ? await ask(
        p.select({
          message: m.credMethod,
          options: [
            { value: 'profile' as const, label: m.credProfile, hint: m.credProfileHint(profiles.length) },
            { value: 'keys' as const, label: m.credKeys, hint: m.credKeysHint },
          ],
        }),
      )
    : 'keys'

  for (;;) {
    let session: Session
    if (method === 'profile') {
      const name = await ask(
        p.select({
          message: m.credPickProfile,
          options: profiles.map((x) => ({
            value: x.name,
            label: x.name,
            hint: [x.region, x.sso ? 'SSO' : ''].filter(Boolean).join(' · ') || undefined,
          })),
        }),
      )
      const info = profiles.find((x) => x.name === name)
      session = profileSession(name, info?.region ?? process.env.AWS_REGION ?? FALLBACK_REGION)
      try {
        const identity = await withSpinner(
          m.credChecking,
          () => whoAmI(session),
          (i) => m.credOk(i.account, i.arn),
        )
        return { session, identity }
      } catch (err) {
        if (info?.sso && isSsoExpired(err)) {
          const login = await ask(p.confirm({ message: m.credSsoLogin(name) }))
          if (login && ssoLogin(name)) continue
        }
        p.log.error(m.credFailed)
        continue
      }
    }

    const accessKeyId = (
      await ask(
        p.text({
          message: 'AWS Access Key ID',
          placeholder: 'AKIA…',
          validate: (v) => (/^A[SK]IA[A-Z0-9]{12,}$/.test((v ?? '').trim()) ? undefined : m.credBadKey),
        }),
      )
    ).trim()
    const secretAccessKey = (
      await ask(
        p.password({ message: 'AWS Secret Access Key', validate: (v) => (v ? undefined : m.required) }),
      )
    ).trim()
    let sessionToken: string | undefined
    if (accessKeyId.startsWith('ASIA'))
      sessionToken = (
        await ask(p.password({ message: m.credSessionToken, validate: (v) => (v ? undefined : m.required) }))
      ).trim()
    session = keysSession(
      { accessKeyId, secretAccessKey, sessionToken },
      process.env.AWS_REGION ?? FALLBACK_REGION,
    )
    try {
      const identity = await withSpinner(
        m.credChecking,
        () => whoAmI(session),
        (i) => m.credOk(i.account, i.arn),
      )
      return { session, identity }
    } catch {
      p.log.error(m.credFailed)
    }
  }
}

export async function askRegion(session: Session): Promise<{ session: Session; bootstrapped: boolean }> {
  const regions = await listRegions(session).catch(() => [session.region])
  const region = await ask(
    p.select({
      message: m.region,
      initialValue: regions.includes(session.region) ? session.region : regions[0],
      options: regions.map((r) => ({
        value: r,
        label: r,
        hint: r === session.region ? m.regionProfile : undefined,
      })),
      maxItems: 12,
    }),
  )
  const s = withRegion(session, region)
  const bootstrapped = await withSpinner(
    m.cdkChecking,
    () => cdkBootstrapped(s),
    (b) => (b ? m.cdkReady : m.cdkNotReady),
  )
  return { session: s, bootstrapped }
}
