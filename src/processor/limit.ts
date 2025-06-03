import type { SelectStmt } from '@supabase/pg-parser/17/types'
import { UnsupportedError } from '../errors.js'
import type { Limit } from './types.js'

export function processLimit(selectStmt: SelectStmt): Limit | undefined {
  let count: number | undefined = undefined
  let offset: number | undefined = undefined

  if (selectStmt.limitCount) {
    if (!('A_Const' in selectStmt.limitCount)) {
      throw new UnsupportedError(`Limit count must be an A_Const`)
    }

    if (!('ival' in selectStmt.limitCount.A_Const)) {
      throw new UnsupportedError(`Limit count must be an integer`)
    }

    if (!selectStmt.limitCount.A_Const.ival) {
      throw new UnsupportedError(`Limit count must have an integer value`)
    }

    count = selectStmt.limitCount.A_Const.ival.ival
  }

  if (selectStmt.limitOffset) {
    if (!('A_Const' in selectStmt.limitOffset)) {
      throw new UnsupportedError(`Limit offset must be an A_Const`)
    }

    if (!('ival' in selectStmt.limitOffset.A_Const)) {
      throw new UnsupportedError(`Limit offset must be an integer`)
    }

    if (!selectStmt.limitOffset.A_Const.ival) {
      throw new UnsupportedError(`Limit offset must have an integer value`)
    }

    offset = selectStmt.limitOffset.A_Const.ival.ival
  }

  if (count === undefined && offset === undefined) {
    return undefined
  }

  return {
    count,
    offset,
  }
}
