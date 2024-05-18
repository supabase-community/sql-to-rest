import { UnsupportedError } from '../errors'
import { SelectStmt } from '../types/libpg-query'
import { Limit } from './types'

export function processLimit(selectStmt: SelectStmt): Limit | undefined {
  let count: number | undefined = undefined
  let offset: number | undefined = undefined

  if (selectStmt.SelectStmt.limitCount) {
    if (!('ival' in selectStmt.SelectStmt.limitCount.A_Const)) {
      throw new UnsupportedError(`Limit count must be an integer`)
    }

    count = selectStmt.SelectStmt.limitCount.A_Const.ival.ival
  }

  if (selectStmt.SelectStmt.limitOffset) {
    if (!('ival' in selectStmt.SelectStmt.limitOffset.A_Const)) {
      throw new UnsupportedError(`Limit offset must be an integer`)
    }

    offset = selectStmt.SelectStmt.limitOffset.A_Const.ival.ival
  }

  if (count === undefined && offset === undefined) {
    return undefined
  }

  return {
    count,
    offset,
  }
}
