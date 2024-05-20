import { stripIndent } from 'common-tags'
import { RenderError } from '../errors'
import { Filter, Select, Statement } from '../processor'
import { renderFilter, renderTargets, uriEncode, uriEncodeParams } from './util'

export type HttpRequest = {
  method: 'GET'
  path: string
  params: URLSearchParams
  fullPath: string
}

/**
 * Renders a `Statement` as an HTTP request.
 */
export async function renderHttp(processed: Statement): Promise<HttpRequest> {
  switch (processed.type) {
    case 'select':
      return formatSelect(processed)
    default:
      throw new RenderError(`Unsupported statement type '${processed.type}'`, 'http')
  }
}

async function formatSelect(select: Select): Promise<HttpRequest> {
  const { from, targets, filter, sorts, limit } = select
  const params = new URLSearchParams()

  if (targets.length > 0) {
    const [firstTarget] = targets

    // Exclude "select=*" if it's the only target
    if (
      firstTarget.type !== 'column-target' ||
      firstTarget.column !== '*' ||
      targets.length !== 1
    ) {
      params.set('select', renderTargets(targets))
    }
  }

  if (filter) {
    renderFilterRoot(params, filter)
  }

  if (sorts) {
    const columns = []

    for (const sort of sorts) {
      let value = sort.column

      if (sort.direction) {
        value += `.${sort.direction}`
      }
      if (sort.nulls) {
        value += `.nulls${sort.nulls}`
      }

      columns.push(value)
    }

    if (columns.length > 0) {
      params.set('order', columns.join(','))
    }
  }

  if (limit) {
    if (limit.count !== undefined) {
      params.set('limit', limit.count.toString())
    }
    if (limit.offset !== undefined) {
      params.set('offset', limit.offset.toString())
    }
  }

  const path = `/${from}`

  return {
    method: 'GET',
    path,
    params,
    get fullPath() {
      if (params.size > 0) {
        return `${path}?${uriEncodeParams(params)}`
      }
      return path
    },
  }
}

function renderFilterRoot(params: URLSearchParams, filter: Filter) {
  const { type } = filter

  // The `and` operator is a special case where we can format each nested
  // filter as a separate query param as long as the `and` is not negated
  if (type === 'logical' && filter.operator === 'and' && !filter.negate) {
    for (const subFilter of filter.values) {
      renderFilterRoot(params, subFilter)
    }
  }
  // Otherwise render as normal
  else {
    const [key, value] = renderFilter(filter)
    params.append(key, value)
  }
}

export function formatHttp(baseUrl: string, httpRequest: HttpRequest) {
  const { method, fullPath } = httpRequest
  const baseUrlObject = new URL(baseUrl)

  return stripIndent`
    ${method} ${baseUrlObject.pathname}${fullPath} HTTP/1.1
    Host: ${baseUrlObject.host}
  `
}

export function formatCurl(baseUrl: string, httpRequest: HttpRequest) {
  const { method, path, params } = httpRequest
  const lines: string[] = []
  const baseUrlObject = new URL(baseUrl)
  const formattedBaseUrl = (baseUrlObject.origin + baseUrlObject.pathname).replace(/\/+$/, '')
  const maybeGFlag = params.size > 0 ? '-G ' : ''

  if (method === 'GET') {
    lines.push(`curl ${maybeGFlag}${formattedBaseUrl}${path}`)
    for (const [key, value] of params) {
      lines.push(`  -d "${uriEncode(key)}=${uriEncode(value)}"`)
    }
  }

  return lines.join(' \\\n')
}
