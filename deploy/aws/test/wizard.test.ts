import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RouteTable } from '@aws-sdk/client-ec2'
import { describe, expect, it } from 'vitest'
import { cacheInVpc, certCovers, isPublicSubnet, onePerAz, type VpcInfo } from '../src/aws/discover.js'
import { childEnv, keysSession, mergeProfiles, profileSession } from '../src/aws/session.js'
import { type DeployConfig, saveConfig } from '../src/config.js'
import { estimateCost, totalCost } from '../src/cost.js'
import { detectLang, dictionaries } from '../src/i18n.js'
import { eligibleVpc, pickSubnets, splitEmails } from '../src/wizard/build.js'

describe('perfiles de AWS', () => {
  it('une config y credentials, detecta SSO y pone default primero', () => {
    const profiles = mergeProfiles(
      {
        zeta: { region: 'us-east-1' },
        default: { region: 'eu-west-1' },
        empresa: { sso_session: 'corp', sso_account_id: '123', region: 'eu-south-2' },
      },
      { default: { aws_access_key_id: 'x' }, solo_claves: { aws_access_key_id: 'y' } },
    )
    expect(profiles.map((p) => p.name)).toEqual(['default', 'empresa', 'solo_claves', 'zeta'])
    expect(profiles.find((p) => p.name === 'empresa')).toMatchObject({ sso: true, region: 'eu-south-2' })
    expect(profiles.find((p) => p.name === 'solo_claves')).toMatchObject({ sso: false, region: undefined })
  })

  it('a cdk solo le llegan las credenciales de la sesión elegida', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAOTRA'
    process.env.AWS_PROFILE = 'otro'
    const byProfile = childEnv(profileSession('empresa', 'eu-west-1'))
    expect(byProfile.AWS_PROFILE).toBe('empresa')
    expect(byProfile.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(byProfile.AWS_REGION).toBe('eu-west-1')

    const byKeys = childEnv(
      keysSession({ accessKeyId: 'AKIAEJEMPLO', secretAccessKey: 's3cr3t' }, 'us-east-1'),
    )
    expect(byKeys.AWS_PROFILE).toBeUndefined()
    expect(byKeys).toMatchObject({ AWS_ACCESS_KEY_ID: 'AKIAEJEMPLO', AWS_SECRET_ACCESS_KEY: 's3cr3t' })
    expect(byKeys.AWS_SESSION_TOKEN).toBeUndefined()
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_PROFILE
  })
})

describe('subredes', () => {
  const tables: RouteTable[] = [
    {
      VpcId: 'vpc-1',
      Associations: [{ Main: true }],
      Routes: [{ DestinationCidrBlock: '10.0.0.0/16', GatewayId: 'local' }],
    },
    {
      VpcId: 'vpc-1',
      Associations: [{ SubnetId: 'subnet-pub' }],
      Routes: [{ DestinationCidrBlock: '0.0.0.0/0', GatewayId: 'igw-123' }],
    },
    {
      VpcId: 'vpc-1',
      Associations: [{ SubnetId: 'subnet-nat' }],
      Routes: [{ DestinationCidrBlock: '0.0.0.0/0', NatGatewayId: 'nat-123' }],
    },
    {
      VpcId: 'vpc-2',
      Associations: [{ Main: true }],
      Routes: [{ DestinationCidrBlock: '0.0.0.0/0', GatewayId: 'igw-999' }],
    },
  ]

  it('es pública si su tabla (o la principal de la VPC) sale por un Internet Gateway', () => {
    expect(isPublicSubnet('subnet-pub', 'vpc-1', tables)).toBe(true)
    expect(isPublicSubnet('subnet-nat', 'vpc-1', tables)).toBe(false)
    // Sin tabla propia: manda la principal de su VPC
    expect(isPublicSubnet('subnet-suelta', 'vpc-1', tables)).toBe(false)
    expect(isPublicSubnet('subnet-suelta', 'vpc-2', tables)).toBe(true)
  })

  const vpc: VpcInfo = {
    id: 'vpc-1',
    cidr: '10.0.0.0/16',
    isDefault: false,
    subnets: [
      { id: 'subnet-a1', az: 'eu-west-1a', cidr: '', public: true },
      { id: 'subnet-a2', az: 'eu-west-1a', cidr: '', public: true },
      { id: 'subnet-b1', az: 'eu-west-1b', cidr: '', public: true },
      { id: 'subnet-pa', az: 'eu-west-1a', cidr: '', public: false },
    ],
  }

  it('un Redis serverless está en la VPC si alguna de sus subredes lo está', () => {
    const base = {
      id: 'r',
      kind: 'serverless' as const,
      engine: 'valkey',
      host: 'h',
      port: 6379,
      tls: true,
      auth: false,
    }
    expect(cacheInVpc({ ...base, subnetIds: ['subnet-x', 'subnet-b1'] }, vpc)).toBe(true)
    expect(cacheInVpc({ ...base, subnetIds: ['subnet-x'] }, vpc)).toBe(false)
    expect(cacheInVpc({ ...base, vpcId: 'vpc-1' }, vpc)).toBe(true)
    expect(cacheInVpc({ ...base, vpcId: 'vpc-2' }, vpc)).toBe(false)
  })

  it('una subred por zona', () => {
    expect(onePerAz(vpc.subnets.filter((s) => s.public)).map((s) => s.id)).toEqual(['subnet-a1', 'subnet-b1'])
  })

  it('Fargate necesita dos zonas públicas; la EC2, una', () => {
    expect(eligibleVpc(vpc, 'fargate')).toBe(true)
    const oneAz = { ...vpc, subnets: vpc.subnets.filter((s) => s.az === 'eu-west-1a') }
    expect(eligibleVpc(oneAz, 'fargate')).toBe(false)
    expect(eligibleVpc(oneAz, 'ec2')).toBe(true)
  })

  it('si no hay privadas en dos zonas, RDS y Redis usan una subred de cada zona', () => {
    const r = pickSubnets(vpc)
    expect(r.publicSubnets).toEqual([
      { id: 'subnet-a1', az: 'eu-west-1a' },
      { id: 'subnet-b1', az: 'eu-west-1b' },
    ])
    expect(r.privateSubnets.map((s) => s.az)).toEqual(['eu-west-1a', 'eu-west-1b'])
  })
})

describe('certificados', () => {
  it('cubre el nombre exacto o un comodín de un nivel', () => {
    expect(certCovers(['cartero.example.com'], 'cartero.example.com')).toBe(true)
    expect(certCovers(['*.example.com'], 'cartero.example.com')).toBe(true)
    expect(certCovers(['*.example.com'], 'a.b.example.com')).toBe(false)
    expect(certCovers(['*.example.com'], 'example.com')).toBe(false)
    expect(certCovers(['otro.example.com', 'EXAMPLE.com'], 'example.com.')).toBe(true)
  })
})

const config = (over: Partial<DeployConfig> = {}): DeployConfig => ({
  version: 1,
  stackName: 'Cartero',
  account: '123456789012',
  region: 'eu-west-1',
  compute: 'fargate',
  image: 'ghcr.io/elrincondeisma/cartero@sha256:0123',
  network: { mode: 'new' },
  database: { mode: 'new' },
  cache: { mode: 'new' },
  domain: { mode: 'none' },
  admin: { emails: ['ana@example.com'], allowRegistration: false },
  allowExistingSgIngress: false,
  ...over,
})

describe('coste', () => {
  it('Fargate con todo nuevo ronda los $80 al mes; la EC2 con todo dentro, los $21', () => {
    const fargate = totalCost(estimateCost(config()))
    const ec2 = totalCost(
      estimateCost(config({ compute: 'ec2', database: { mode: 'container' }, cache: { mode: 'container' } })),
    )
    expect(fargate).toBeGreaterThan(70)
    expect(fargate).toBeLessThan(90)
    expect(ec2).toBeGreaterThan(18)
    expect(ec2).toBeLessThan(26)
  })

  it('reutilizar la base de datos y Redis no suma su coste', () => {
    const lines = estimateCost(
      config({
        database: { mode: 'existing', host: 'h', port: 5432, name: 'c', secretArn: 'arn', ssl: true },
        cache: { mode: 'existing', host: 'r', port: 6379, tls: true },
      }),
    )
    expect(lines.map((l) => l.key)).not.toContain('rds')
    expect(lines.map((l) => l.key)).not.toContain('elasticache')
  })
})

describe('configuración guardada', () => {
  it('se guarda sin secretos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cartero-aws-'))
    const file = saveConfig(dir, config())
    expect(readFileSync(file, 'utf8')).not.toMatch(/password|secretAccessKey|AKIA/i)
  })

  it('se niega a guardar algo que parezca una contraseña', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cartero-aws-'))
    const bad = { ...config(), database: { mode: 'existing', password: 'x' } } as unknown as DeployConfig
    expect(() => saveConfig(dir, bad)).toThrow(/secretos/)
  })
})

describe('idiomas', () => {
  it('español e inglés tienen los mismos textos', () => {
    const keys = (o: object) => Object.keys(o).sort()
    expect(keys(dictionaries.en)).toEqual(keys(dictionaries.es))
    expect(keys(dictionaries.en.costLabel)).toEqual(keys(dictionaries.es.costLabel))
  })

  it('elige el idioma del sistema', () => {
    expect(detectLang({ LANG: 'es_ES.UTF-8' })).toBe('es')
    expect(detectLang({ LANG: 'en_GB.UTF-8' })).toBe('en')
    expect(detectLang({ LC_ALL: 'es_MX.UTF-8', LANG: 'en_US' })).toBe('es')
  })

  it('separa los emails por comas o espacios', () => {
    expect(splitEmails('ana@x.com, luis@y.com;  ')).toEqual(['ana@x.com', 'luis@y.com'])
    expect(splitEmails('')).toEqual([])
  })
})
