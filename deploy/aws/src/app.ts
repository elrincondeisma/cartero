#!/usr/bin/env node
/**
 * App de CDK: lee el DeployConfig (ruta en el contexto `config` o en CARTERO_AWS_CONFIG) y crea el
 * stack. La lanza el asistente con `cdk deploy`; también se puede usar a mano con `cdk synth`.
 */
import { App } from 'aws-cdk-lib'
import { loadConfig, validateConfig } from './config.js'
import { CarteroStack } from './stack/cartero-stack.js'

const app = new App()
const file = (app.node.tryGetContext('config') as string | undefined) ?? process.env.CARTERO_AWS_CONFIG
if (!file) throw new Error('Falta la configuración: cdk … -c config=cartero-aws.<stack>.json')
const config = loadConfig(file)
const errors = validateConfig(config)
if (errors.length) throw new Error(`Configuración no válida:\n- ${errors.join('\n- ')}`)

new CarteroStack(app, config.stackName, {
  config,
  env: { account: config.account, region: config.region },
  description: `Cartero (${config.compute}) — desplegado con el asistente de Cartero para AWS`,
})
