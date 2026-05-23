import { UnsupportedError } from '../errors'
import { InsertStmt } from '../types/libpg-query'
import { Insert } from './types'

export function processInsertStatement(stmt: InsertStmt): Insert {
  const { InsertStmt: insertStmt } = stmt

  // Extract table name
  if (!insertStmt.relation) {
    throw new UnsupportedError('INSERT statement must specify a table')
  }

  const tableName = insertStmt.relation.relname

  // Handle column names
  const columns: string[] = []
  if (insertStmt.cols) {
    for (const col of insertStmt.cols) {
      if ('ResTarget' in col) {
        if (col.ResTarget.name) {
          columns.push(col.ResTarget.name)
        }
      } else {
        throw new UnsupportedError('INSERT column specification must be a simple column name')
      }
    }
  }

  // Process values
  const values: (string | number | boolean | null)[][] = []
  
  if (insertStmt.selectStmt) {
    if (insertStmt.selectStmt.SelectStmt.valuesLists) {
      // Handle VALUES clause
      for (const valueList of insertStmt.selectStmt.SelectStmt.valuesLists) {
        const rowValues: (string | number | boolean | null)[] = []
        
        for (const value of valueList.List.items) {
          if ('A_Const' in value) {
            const constValue = value.A_Const
            if ('sval' in constValue && 'sval' in constValue.sval) {
              rowValues.push(constValue.sval.sval)
            } else if ('ival' in constValue && 'ival' in constValue.ival) {
              rowValues.push(constValue.ival.ival)
            } else if ('fval' in constValue && 'fval' in constValue.fval) {
              rowValues.push(constValue.fval.fval)
            } else if ('boolval' in constValue) {
              rowValues.push(constValue.boolval)
            } else if ('Null' in constValue) {
              rowValues.push(null)
            } else {
              throw new UnsupportedError(`Unsupported constant type in INSERT values`)
            }
          } else {
            throw new UnsupportedError('INSERT values must be constants (no expressions or subqueries)')
          }
        }
        
        values.push(rowValues)
      }
    } else {
      // Handle INSERT ... SELECT (not supported for now)
      throw new UnsupportedError('INSERT ... SELECT statements are not supported')
    }
  }

  // Handle RETURNING clause
  let returning: string[] | undefined
  if (insertStmt.returningList) {
    returning = []
    for (const returnTarget of insertStmt.returningList) {
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

  // Check for ON CONFLICT (not supported)
  if (insertStmt.onConflictClause) {
    throw new UnsupportedError('INSERT ... ON CONFLICT (upsert) is not supported')
  }

  return {
    type: 'insert',
    into: tableName,
    columns,
    values,
    returning,
  }
}
