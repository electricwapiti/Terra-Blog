import express from 'express';
const app = express();
const port = 3002;
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.render('index.ejs');
});

app.get('/signup', (req, res) => {
    res.render('signup.ejs');
});

app.get('/login', (req, res) => {
    res.render('login.ejs');
});
app.get('/blog', (req, res) => {
    res.render('blog.ejs');
});
app.get('/write', (req, res) => {
    res.render('write.ejs');
});
app.get('/view', (req, res) => {
    res.render('view.ejs');
});
app.get('/edit', (req, res) => {
    res.render('edit.ejs');
});


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});