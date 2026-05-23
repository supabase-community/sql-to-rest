import { UnsupportedError } from '../errors'
import { DeleteStmt } from '../types/libpg-query'
import { processWhereClause } from './filter'
import { Delete, Relations } from './types'

export function processDeleteStatement(stmt: DeleteStmt): Delete {
  const { DeleteStmt: deleteStmt } = stmt

  // Extract table name
  if (!deleteStmt.relation) {
    throw new UnsupportedError('DELETE statement must specify a table')
  }

  const tableName = deleteStmt.relation.relname

  // Process WHERE clause with basic filter validation
  let filter
  if (deleteStmt.whereClause) {
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

    filter = processWhereClause(deleteStmt.whereClause, relations)
    
    // Validate that only basic operators are used
    validateBasicFilters(filter)
  }

  // Handle RETURNING clause
  let returning: string[] | undefined
  if (deleteStmt.returningList) {
    returning = []
    for (const returnTarget of deleteStmt.returningList) {
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
    type: 'delete',
    from: tableName,
    filter,
    returning,
  }
}

function validateBasicFilters(filter: any): void {
  if (filter.type === 'column') {
    const allowedOperators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
    if (!allowedOperators.includes(filter.operator)) {
      throw new UnsupportedError(`DELETE WHERE clause only supports basic operators: ${allowedOperators.join(', ')}`)
    }
  } else if (filter.type === 'logical') {
    // Recursively validate nested filters
    for (const subFilter of filter.values) {
      validateBasicFilters(subFilter)
    }
  }
}
