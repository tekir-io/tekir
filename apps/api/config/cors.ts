export default {
  enabled: true,
  origin: ['http://localhost:3000'],
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  headers: true,
  credentials: true,
  maxAge: 86400,
}
