import { parseQuery } from 'libpg-query'
import { ParsingError, UnimplementedError, UnsupportedError, getParsingErrorHint } from '../errors'
import { ParsedQuery, Stmt } from '../types/libpg-query'
import { processSelectStatement } from './select'
import { Statement } from './types'

export { supportedAggregateFunctions } from './select'
export * from './types'
export { everyTarget, flattenTargets, someFilter, someTarget } from './util'

/**
 * Coverts SQL into a PostgREST-compatible `Statement`.
 *
 * Expects SQL to contain only one statement.
 *
 * @returns An intermediate `Statement` object that
 * can be rendered to various targets (HTTP, supabase-js, etc).
 */
export async function processSql(sql: string): Promise<Statement> {
  try {
    const result: ParsedQuery = await parseQuery(sql)

    if (result.stmts.length === 0) {
      throw new UnsupportedError('Expected a statement, but received none')
    }

    if (result.stmts.length > 1) {
      throw new UnsupportedError('Expected a single statement, but received multiple')
    }

    const [statement] = result.stmts.map((stmt) => processStatement(stmt))

    return statement
  } catch (err) {
    if (err instanceof Error && 'cursorPosition' in err) {
      const hint = getParsingErrorHint(err.message)
      const parsingError = new ParsingError(err.message, hint)

      Object.assign(parsingError, err)
      throw parsingError
    } else {
      throw err
    }
  }
}

/**
 * Converts a pg-query `Stmt` into a PostgREST-compatible `Statement`.
 */
function processStatement({ stmt }: Stmt): Statement {
  if ('SelectStmt' in stmt) {
    return processSelectStatement(stmt)
  } else if ('InsertStmt' in stmt) {
    throw new UnimplementedError(`Insert statements are not yet implemented by the translator`)
  } else if ('UpdateStmt' in stmt) {
    throw new UnimplementedError(`Update statements are not yet implemented by the translator`)
  } else if ('DeleteStmt' in stmt) {
    throw new UnimplementedError(`Delete statements are not yet implemented by the translator`)
  } else if ('ExplainStmt' in stmt) {
    throw new UnimplementedError(`Explain statements are not yet implemented by the translator`)
  } else {
    const [stmtType] = Object.keys(stmt)
    const statementType = stmtType.replace(/Stmt$/, '')
    throw new UnsupportedError(`${statementType} statements are not supported`)
  }
}
