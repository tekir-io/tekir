import { createElement } from 'react'
import { renderToString, renderToReadableStream } from 'react-dom/server'
import type { ViewConfig } from '@tekir/view'

export default {
  engine: {
    render(component, props) {
      const el = typeof component === 'function' ? createElement(component, props || {}) : component
      return '<!DOCTYPE html>' + renderToString(el)
    },
    async renderStream(component, props) {
      const el = typeof component === 'function' ? createElement(component, props || {}) : component
      return renderToReadableStream(el)
    }
  }
} satisfies ViewConfig
