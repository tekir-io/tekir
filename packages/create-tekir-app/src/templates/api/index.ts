import './types'
import { tekir } from '@tekir/core'
import env from '#env'

const { start } = await tekir({
  envFile: 'env.ts',
  configDir: 'config',
  startDir: 'start',
})

start(() => {
  console.log(`Server running at http://localhost:${env.PORT}`)
})
