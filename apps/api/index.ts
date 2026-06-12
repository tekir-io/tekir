import './types'
import { tekir } from '@tekir/core'

const app = await tekir({
  envFile: 'env.ts',
  configDir: 'config',
  startDir: 'start',
})

app.start(() => {
  console.log(`Server running at http://localhost:${process.env.PORT || 4001}`)
})
