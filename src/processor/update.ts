import { UnsupportedError } from '../errors'
import { UpdateStmt } from '../types/libpg-query'
import { processWhereClause } from './filter'
import { Update, Relations } from './types'

export function processUpdateStatement(stmt: UpdateStmt): Update {
  const { UpdateStmt: updateStmt } = stmt

  // Extract table name
  if (!updateStmt.relation) {
    throw new UnsupportedError('UPDATE statement must specify a table')
  }

  const tableName = updateStmt.relation.relname

  // Process SET clause
  const setClause: Record<string, string | number | boolean | null> = {}
  
  if (!updateStmt.targetList) {
    throw new UnsupportedError('UPDATE statement must have a SET clause')
  }

  for (const target of updateStmt.targetList) {
    if ('ResTarget' in target) {
      const resTarget = target.ResTarget
      const columnName = resTarget.name
      
      if (!columnName) {
        throw new UnsupportedError('UPDATE SET clause must specify column names')
      }

      // Process the value
      if ('A_Const' in resTarget.val) {
        const constValue = resTarget.val.A_Const as any
        if ('sval' in constValue && 'sval' in constValue.sval) {
          setClause[columnName] = constValue.sval.sval
        } else if ('ival' in constValue && 'ival' in constValue.ival) {
          setClause[columnName] = constValue.ival.ival
        } else if ('fval' in constValue && 'fval' in constValue.fval) {
          setClause[columnName] = constValue.fval.fval
        } else if ('boolval' in constValue) {
          setClause[columnName] = constValue.boolval
        } else if ('Null' in constValue) {
          setClause[columnName] = null
        } else {
          throw new UnsupportedError(`Unsupported constant type in UPDATE SET clause`)
        }
      } else {
        throw new UnsupportedError('UPDATE SET clause only supports constant values (no expressions or subqueries)')
      }
    } else {
      throw new UnsupportedError('UPDATE SET clause must be simple column assignments')
    }
  }

  // Process WHERE clause with basic filter validation
  let filter
  if (updateStmt.whereClause) {
    // Create a minimal relations object for the table
    const relations: Relations = {
      primary: {
        name: tableName,
        get reference() {
          return this.name
        }
      },
      joined: []
    }

    filter = processWhereClause(updateStmt.whereClause, relations)
    
    // Validate that only basic operators are used
    validateBasicFilters(filter)
  }

  // Handle RETURNING clause
  let returning: string[] | undefined
  if (updateStmt.returningList) {
    returning = []
    for (const returnTarget of updateStmt.returningList) {
      if ('ResTarget' in returnTarget) {
        const target = returnTarget.ResTarget
        if ('ColumnRef' in target.val) {
          const columnName = target.val.ColumnRef.fields
            .map((field: any) => 'String' in field ? field.String.sval : '')
            .join('.')
            .split('.')
            .pop() // Get the last part (column name)
          
          if (columnName) {
            returning.push(columnName)
          }
        } else {
          throw new UnsupportedError('RETURNING clause only supports simple column names')
        }
      } else {
        throw new UnsupportedError('RETURNING clause only supports simple column names')
      }
    }
  }

  return {
    type: 'update',
    table: tableName,
    set: setClause,
    filter,
    returning,
  }
}

function validateBasicFilters(filter: any): void {
  if (filter.type === 'column') {
    const allowedOperators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
    if (!allowedOperators.includes(filter.operator)) {
      throw new UnsupportedError(`UPDATE WHERE clause only supports basic operators: ${allowedOperators.join(', ')}`)
    }
  } else if (filter.type === 'logical') {
    // Recursively validate nested filters
    for (const subFilter of filter.values) {
      validateBasicFilters(subFilter)
    }
  }
}
