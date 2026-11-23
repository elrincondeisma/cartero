import type { Contract } from '@cartero/core'
import { type ExchangeCheck, checkExchange } from '@cartero/contracts'
import type { Execution } from '@/api/types'

export type ContractCheck = ExchangeCheck

/** Comprueba lo que se envió y lo que llegó contra el contrato de la petición. */
export function checkExecution(contract: Contract, templateUrl: string, execution: Execution): ContractCheck {
  return checkExchange(contract, templateUrl, execution.request, execution.response)
}
