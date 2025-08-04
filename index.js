import express from "express";
import multer from "multer";
import session from "express-session";
import supabase from "./utils/supabaseClient.js";
import fs from "fs";

const app = express();
const port = 3002;
const upload = multer({ dest: "uploads/" });

// Middleware
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({ secret: "terra-secret", resave: false, saveUninitialized: true })
);

// Signup route to sign up w/ supabase auth, upload profile image to supabase storage,
// store username & profile image URL in profiles table with this POST /signup route:
app.post("/signup", upload.single("profileImage"), async (req, res) => {
  const { email, password, username } = req.body;
  const profileImage = req.file;
  if (!email || !password || !username || !profileImage) {
    return res.status(400).send("Missing required fields");
  }

  try {
    // Sign up user in Supabase Auth
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp(
      {
        email,
        password,
      }
    );

    if (signUpError) throw signUpError;
    const userId = signUpData.user.id;

    // Upload profile image to Supabase Storage
    const fileExt = profileImage.originalname.split(".").pop();
    const filePath = `public/${userId}.${fileExt}`;
    const fileBuffer = fs.readFileSync(profileImage.path);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("profile-image")
      .upload(filePath, fileBuffer, {
        contentType: profileImage.mimetype,
      });
    
    if (uploadError) {
      console.error("upload error: ", uploadError);
      throw uploadError;
    } uploadError;

    // Get public image URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("profile-image").getPublicUrl(filePath);

    // Insert profile into `profiles` table
    const { error: profileInsertError } = await supabase
      .from("profiles")
      .insert({
        id: userId,
        username,
        profile_image_url: publicUrl,
      });

    if (profileInsertError) throw profileInsertError;

    // Delete temp storage of profile image
    fs.unlink(profileImage.path, (err) => {
      if (err) console.warn("Failed to delete local image:", err);
    });

    // Store session
    req.session.user = { id: userId };
    res.redirect("/blog");
  } catch (err) {
    console.error("Signup failed", err.message || err);
    res.status(500).send("Signup failed. please try again.");
  }
});

// Log in route with supabase auth
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.session) {
      console.log('Login error:', error?.message || 'No session returned');
      return res.status(401).send('Invalid email or password');
    }

    // Save user id and access token in session
    req.session.user = {
      id: data.user.id,
      accessToken: data.session.access_token
    };

    res.redirect('/blog');
  } catch (err) {
    console.error('Login failed:', err.message || err);
    res.status(500).send('Login failed, please try again');
  }
});

// Write route to post blog
app.post('/write', upload.single('blogImage'), async (req, res) => {
  const { title, content } = req.body;
  console.log("Blog title:", title);
  console.log("Blog content:", JSON.stringify(content));
  console.log("Uploading to bucket:", supabase.storage.from('blog-image'));
  const blogImage = req.file;
  const user = req.session.user;

  // Just in case, check if user isn't authenticated. They shouldn't even get to this page.
  if (!user || !user.id) {
    return res.status(401).send('You must be logged in to post a blog.');
  }

  try {
    // Upload image to Supabase Storage
    const fileExt = blogImage.originalname.split('.').pop();
    const filePath = `public/${user.id}-${Date.now()}.${fileExt}`;
    const fileBuffer = fs.readFileSync(blogImage.path);
    console.log('the image url starts out as :' + filePath);
    const { error: uploadError } = await supabase.storage.from('blog-image').upload(filePath, fileBuffer, {
      contentType: blogImage.mimetype
    });
    
    if(uploadError) throw uploadError;
    

    // Get public URL for the blog image
    const { data: { publicUrl } } = supabase.storage.from('blog-image').getPublicUrl(filePath);

    // Insert blog into Supabase
    const { error: insertError } = await supabase.from('blogs').insert({
      author_id: user.id,
      title,
      content,
      image_url: publicUrl,
      created_at: new Date().toISOString()
    });

    if (insertError) throw insertError;

    // Cleanup local file
    fs.unlink(blogImage.path, (err) => {
      if (err) console.warn('Failed to delete local file:', err);
    });

    // Redirect to blog list or success page
    res.redirect('/blog');
  } catch (err) {
    console.error('Blog post failed:', err.message || err);
    res.status(500).send(`Failed to post blog: ${err.message}`);
  }
});

// Gather info about blogs from profiles and blogs tables, assemble the blogs with 
// the blog-cards.ejs template, and display by order they were published
// There's a foreign key relationship, so the blogs entry can embed the 
// profiles entry in the space where the author id was in the blogs entry.
app.get('/blog', async (req, res) => {
  try {
    const { data: blogs, error } = await supabase.from('blogs')
    .select(`id, title, content, image_url, created_at, profiles 
      ( id, username, profile_image_url )
    `).order('created_at', { ascending: false });
    if (error) throw error;
    const userId = req.session?.user?.id || null;

    console.log("---------------------------------")
    blogs.forEach(blog => {
      console.log(`Blog ID: ${blog.id} | Image URL: ${blog.image_url}`);
    });
    console.log("---------------------------------")

    res.render('blog.ejs', {
      blogs,
      currentUser: userId,
      userIsSignedIn: !!userId
    });
  } catch (err) {
    console.error('Error loading blogs:', err.message);
    res.status(500).send('Couldnt load blogs');
  }
});

// Set all the links to the correct files
app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/signup", (req, res) => {
  res.render("signup.ejs");
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/write", (req, res) => {
  res.render("write.ejs");
});
app.get("/view/:id", async (req, res) => {
  try {
    const blogId = req.params.id;
    const { data: blog, error } = await supabase.from('blogs').select(
      `id, title, content, image_url, created_at, profiles ( id, username, profile_image_url )`).eq('id', blogId).single();
    if (error || !blog) throw error;

    const userId = req.session?.user?.id || null;
    console.log('Loaded blog:', blog);
    
    res.render('view.ejs', {
      blog,
      currentUser: userId,
      userIsSignedIn: !!userId,
    });
  } catch (err) {
    console.error('failed to load blog post:', err.message);
    res.status(500).send('could not load blog post.');
  }
});
app.get("/edit", (req, res) => {
  res.render("edit.ejs");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
