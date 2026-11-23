#!/usr/bin/env node
/**
 * MCP por stdio para clientes locales (Claude Desktop, Claude Code, Cursor…).
 *   CARTERO_SERVER=https://cartero.ejemplo.com CARTERO_TOKEN=crt_… npx @cartero/mcp
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCarteroMcpServer } from './index.js'

const baseUrl = process.env.CARTERO_SERVER
const token = process.env.CARTERO_TOKEN
if (!baseUrl || !token) {
  console.error(
    'Faltan CARTERO_SERVER y/o CARTERO_TOKEN (crea un token en Cartero → Ajustes → Tokens de API)',
  )
  process.exit(2)
}

const server = createCarteroMcpServer({ baseUrl, token })
await server.connect(new StdioServerTransport())
