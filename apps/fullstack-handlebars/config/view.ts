import Handlebars from 'handlebars'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ViewConfig } from '@tekir/view'

const viewsDir = join(process.cwd(), 'resources/views')

// Register layout partial
const layoutSource = readFileSync(join(viewsDir, 'layouts/main.hbs'), 'utf-8')
Handlebars.registerPartial('layout', layoutSource)

// Register helpers
Handlebars.registerHelper('eq', (a, b) => a === b)
Handlebars.registerHelper('truncate', (str: string, len: number) =>
  str.length > len ? str.substring(0, len) + '...' : str
)
Handlebars.registerHelper('date', (str: string) =>
  new Date(str).toLocaleDateString()
)

export default {
  engine: {
    render(template, data) {
      const filePath = join(viewsDir, template + '.hbs')
      const source = readFileSync(filePath, 'utf-8')
      return '<!DOCTYPE html>' + Handlebars.compile(source)(data)
    }
  }
} satisfies ViewConfig
