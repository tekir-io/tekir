/**
 * Dev entry. Boots the example app on port 5001.
 */
import { server } from './server'

server.start()
console.log('tekir example: http://localhost:5001')
console.log('  GET  /            hello')
console.log('  GET  /health      uptime')
console.log('  GET  /users       list')
console.log('  GET  /users/:id   one')
console.log('  POST /users       create')
console.log('  POST /echo        echo body')
console.log('  GET  /docs        swagger ui')
