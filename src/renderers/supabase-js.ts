import * as babel from 'prettier/plugins/babel'
import * as estree from 'prettier/plugins/estree'
import * as prettier from 'prettier/standalone'
import { RenderError } from '../errors'
import { Filter, Select, Statement } from '../processor'
import { renderNestedFilter, renderTargets } from './util'

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
      throw new RenderError(`Unsupported statement type '${processed.type}'`, 'supabase-js')
  }
}

async function formatSelect(select: Select): Promise<SupabaseJsQuery> {
  const { from, targets, filter, sorts, limit } = select
  const lines = ['const { data, error } = await supabase', `.from('${from}')`]

  if (targets.length > 0) {
    const [firstTarget] = targets

    // Remove '*' from select() if it's the only target
    if (
      firstTarget.type === 'column-target' &&
      firstTarget.column === '*' &&
      targets.length === 1
    ) {
      lines.push('.select()')
    } else if (targets.length > 1) {
      lines.push(
        `.select(\n    \`\n${renderTargets(targets, { initialIndent: 4, indent: 2 })}\n    \`\n )`
      )
    } else {
      lines.push(`.select(${JSON.stringify(renderTargets(targets))})`)
    }
  }

  if (filter) {
    renderFilterRoot(lines, filter)
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
      throw new RenderError(`supabase-js doesn't support an offset without a limit`, 'supabase-js')
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

function renderFilterRoot(lines: string[], filter: Filter) {
  const { type } = filter

  if (filter.negate) {
    if (filter.type === 'column') {
      // Full-text search operators can have an optional config arg
      if (
        filter.operator === 'fts' ||
        filter.operator === 'plfts' ||
        filter.operator === 'phfts' ||
        filter.operator === 'wfts'
      ) {
        const maybeConfig = filter.config ? `(${filter.config})` : ''
        lines.push(
          `.not(${JSON.stringify(filter.column)}, ${JSON.stringify(`${filter.operator}${maybeConfig}`)}, ${JSON.stringify(filter.value)})`
        )
      } else {
        lines.push(
          `.not(${JSON.stringify(filter.column)}, ${JSON.stringify(filter.operator)}, ${JSON.stringify(filter.value)})`
        )
      }
    }
    // supabase-js doesn't support negated logical operators.
    // We work around this by wrapping the filter in an 'or'
    // with only 1 value (so the 'or' is a no-op, but we get nested PostgREST syntax)
    else if (filter.type === 'logical') {
      lines.push(`.or(${JSON.stringify(renderNestedFilter(filter, false, ', '))})`)
    }
    return
  }

  // Column filter, eg. .eq('title', 'Cheese')
  if (type === 'column') {
    if (
      filter.operator === 'fts' ||
      filter.operator === 'plfts' ||
      filter.operator === 'phfts' ||
      filter.operator === 'wfts'
    ) {
      const maybeOptions =
        filter.operator !== 'fts' || filter.config !== undefined
          ? `, ${JSON.stringify({
              type: mapTextSearchType(filter.operator),
              config: filter.config,
            })}`
          : ''

      lines.push(
        `.textSearch(${JSON.stringify(filter.column)}, ${JSON.stringify(filter.value)}${maybeOptions})`
      )
    } else {
      lines.push(
        `.${filter.operator}(${JSON.stringify(filter.column)}, ${JSON.stringify(filter.value)})`
      )
    }
  }

  // Logical operator filter, eg. .or('title.eq.Cheese,title.eq.Salsa')
  else if (type === 'logical') {
    // The `and` operator is a a special case where we can format each nested
    // filter as a separate filter method
    if (filter.operator === 'and') {
      for (const subFilter of filter.values) {
        renderFilterRoot(lines, subFilter)
      }
    }
    // Otherwise use the .or(...) method
    else if (filter.operator === 'or') {
      lines.push(
        `.or(${JSON.stringify(
          filter.values.map((subFilter) => renderNestedFilter(subFilter, false, ', ')).join(', ')
        )})`
      )
    }
  } else {
    throw new RenderError(`Unknown filter type '${type}'`, 'supabase-js')
  }
}

function mapTextSearchType(operator: 'fts' | 'plfts' | 'phfts' | 'wfts') {
  switch (operator) {
    case 'plfts':
      return 'plain'
    case 'phfts':
      return 'phrase'
    case 'wfts':
      return 'websearch'
    default:
      return undefined
  }
}
