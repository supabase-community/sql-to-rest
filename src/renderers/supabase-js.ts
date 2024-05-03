import { Filter, Select, Statement } from '../processor'
import * as prettier from 'prettier/standalone'
import * as babel from 'prettier/plugins/babel'
import * as estree from 'prettier/plugins/estree'

export type SupabaseJsQuery = {
  code: string
}

/**
 * Renders a `Statement` as a supabase-js query.
 */
export async function renderSupabaseJs(processed: Statement): Promise<SupabaseJsQuery> {
  switch (processed.type) {
    case 'select':
      return formatSelect(processed)
    default:
      throw new Error(`Unsupported statement type '${processed.type}'`)
  }
}

async function formatSelect(select: Select): Promise<SupabaseJsQuery> {
  const { from, targets, filter, sorts, limit } = select
  const lines = ['const { data, error } = await supabase', `.from('${from}')`]

  if (targets.length > 0) {
    const [firstTarget] = targets

    // Remove '*' from select() if it's the only target
    if (firstTarget.column === '*' && targets.length === 1) {
      lines.push('.select()')
    } else {
      const renderedTargets = targets.map(({ column, alias, cast }) => {
        let value = column

        if (alias && alias !== column) {
          value = `${alias}:${value}`
        }

        if (cast) {
          value = `${value}::${cast}`
        }

        return value
      })

      lines.push(`.select(${JSON.stringify(renderedTargets.join(', '))})`)
    }
  }

  if (filter) {
    formatSelectFilterRoot(lines, filter)
  }

  if (sorts) {
    for (const sort of sorts) {
      if (!sort.direction && !sort.nulls) {
        lines.push(`.order(${JSON.stringify(sort.column)})`)
      } else {
        const options = {
          ascending: sort.direction ? sort.direction === 'asc' : undefined,
          nullsFirst: sort.nulls ? sort.nulls === 'first' : undefined,
        }

        lines.push(`.order(${JSON.stringify(sort.column)}, ${JSON.stringify(options)})`)
      }
    }
  }

  if (limit) {
    if (limit.count !== undefined && limit.offset === undefined) {
      lines.push(`.limit(${limit.count})`)
    } else if (limit.count === undefined && limit.offset !== undefined) {
      throw new Error(`supabase-js doesn't support an offset without a limit`)
    } else if (limit.count !== undefined && limit.offset !== undefined) {
      lines.push(`.range(${limit.offset}, ${limit.offset + limit.count})`)
    }
  }

  // Join lines together and format
  const code = await prettier.format(lines.join('\n'), {
    parser: 'babel',
    plugins: [babel, estree],
    printWidth: 40,
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
  })

  return {
    code: code.trim(),
  }
}

function formatSelectFilterRoot(lines: string[], filter: Filter) {
  const { type } = filter

  if (filter.negate) {
    if (filter.type === 'column') {
      const value = typeof filter.value === 'string' ? `'${filter.value}'` : filter.value
      lines.push(
        `.not(${JSON.stringify(filter.column)}, ${JSON.stringify(filter.operator)}, ${JSON.stringify(filter.value)})`
      )
    }
    // supabase-js doesn't support negated logical operators.
    // We work around this by wrapping the filter in an 'or'
    // with only 1 value
    else if (filter.type === 'logical') {
      lines.push(`.or(${JSON.stringify(formatSelectFilter(filter))})`)
    }
    return
  }

  // Column filter, eg. .eq('title', 'Cheese')
  if (type === 'column') {
    const value = typeof filter.value === 'string' ? `'${filter.value}'` : filter.value
    lines.push(
      `.${filter.operator}(${JSON.stringify(filter.column)}, ${JSON.stringify(filter.value)})`
    )
  }

  // Logical operator filter, eg. .or('title.eq.Cheese,title.eq.Salsa')
  else if (type === 'logical') {
    // The `and` operator is a a special case where we can format each nested
    // filter as a separate filter method
    if (filter.operator === 'and') {
      for (const subFilter of filter.values) {
        formatSelectFilterRoot(lines, subFilter)
      }
    }
    // Otherwise use the .or(...) method
    else if (filter.operator === 'or') {
      lines.push(
        `.or(${JSON.stringify(filter.values.map((subFilter) => formatSelectFilter(subFilter)).join(', '))})`
      )
    }
  } else {
    throw new Error(`Unknown filter type '${type}'`)
  }
}

function formatSelectFilter(filter: Filter): string {
  const { type } = filter
  const maybeNot = filter.negate ? 'not.' : ''

  if (type === 'column') {
    return `${maybeNot}${filter.column}.${filter.operator}.${filter.value}`
  } else if (type === 'logical') {
    return `${maybeNot}${filter.operator}(${filter.values.map((subFilter) => formatSelectFilter(subFilter)).join(', ')})`
  } else {
    throw new Error(`Unknown filter type '${type}'`)
  }
}