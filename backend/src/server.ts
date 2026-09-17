import app from './app.js'

const port = Number(process.env.PORT ?? 5000)

app.listen(port, () => {
  console.log(`Murama School API running on http://localhost:${port}`)
})
