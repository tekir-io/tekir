import { TekirServer } from '@tekir/core'

const app = new TekirServer()
const router = app.getRouter()

router.get('/json', () => ({ message: 'Hello, World!' }))
router.get('/users/:id', ({ params }: any) => ({ id: params.id, name: `User ${params.id}` }))
router.get('/posts/:postId/comments/:commentId', ({ params }: any) => ({ postId: params.postId, commentId: params.commentId }))
router.post('/users', ({ body }: any) => ({ created: true, user: body }))
router.get('/search', ({ query }: any) => ({ query: query.q, page: query.page || '1' }))

app.configure({ port: Number(process.env.PORT) || 3001 })
app.start()
