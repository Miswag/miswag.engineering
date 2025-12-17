# Miswag Tech Blog

A professional tech blog built with Next.js and deployed on GitHub Pages.

## Features

- 📝 Markdown-based articles
- 🎨 Clean, professional design
- 🔍 Article filtering and sorting
- 👥 Team member profiles
- 📱 Fully responsive
- 🚀 Static site generation for fast loading

## Project Structure

```
miswag-tech-blog/
├── public/
│   ├── content/          # JSON configuration files
│   ├── data/             # Article markdown files and images
│   ├── avatars/          # Team member avatars
│   ├── logo.png
│   └── favicon.png
├── app/                  # Next.js app directory
├── components/           # React components
└── .github/workflows/    # GitHub Actions for deployment
```

## Development

Install dependencies:
```bash
npm install
```

Run development server:
```bash
npm run dev
```

Build for production:
```bash
npm run build
```

## Adding Content

### Adding a New Article

1. **Create article directory:**
   ```bash
   mkdir public/data/my-new-article
   ```

2. **Create the markdown file:**
   Create `public/data/my-new-article/index.md` with your content:
   ```markdown
   # My Article Title

   Your article content here with markdown formatting.

   ## Section heading

   - Bullet points
   - Code blocks
   - Images

   ```python
   # Code example
   print("Hello World")
   ```
   ```

3. **Add images (optional):**
   Place any images in the same folder:
   ```bash
   public/data/my-new-article/image1.png
   ```

4. **Add metadata to `public/content/articles.json`:**
   ```json
   {
     "article_id": "my-new-article",
     "article_title": "My Article Title",
     "author_team_id": 1,
     "category_id": 1,
     "article_created_at": "2025-12-17",
     "article_keywords": ["keyword1", "keyword2"],
     "article_description": "Brief description of the article",
     "article_directory": "my-new-article",
     "featured_image": "image1.png"
   }
   ```

### Adding a New Team Member

1. **Add avatar image:**
   ```bash
   # Add image to public/avatars/
   public/avatars/newmember.png
   ```

2. **Add member info to `public/content/team.json`:**
   ```json
   {
     "team_id": 3,
     "team_member_name": "New Member Name",
     "team_member_position": "Position Title",
     "team_member_linkedin": "https://www.linkedin.com/in/username/",
     "team_member_avatar": "newmember.png",
     "team_member_bio": "Short bio about the team member"
   }
   ```

### Adding a New Category

Add a new category to `public/content/categories.json`:
```json
{
  "category_id": 5,
  "category_name": "New Category Name"
}
```

Then you can reference this category when creating articles using `"category_id": 5`.

### Updating the About Page

Edit `public/content/about.json` to customize the about page content:
```json
{
  "title": "About Us",
  "subtitle": "Your subtitle here",
  "mission": {
    "heading": "Our Mission",
    "description": "Your mission statement..."
  },
  "values": [
    {
      "icon": "BookOpen",
      "title": "Value Title",
      "description": "Value description"
    }
  ],
  "contact": {
    "heading": "Get in Touch",
    "description": "Contact section text..."
  }
}
```

**Available icons:** `BookOpen`, `Users`, `TrendingUp`, `Target`

### Updating Footer Social Links

Edit `public/content/footer.json` to customize the footer:
```json
{
  "copyright": "© 2025 Your Company. All rights reserved.",
  "socialLinks": [
    {
      "name": "GitHub",
      "url": "https://github.com/yourcompany"
    },
    {
      "name": "LinkedIn",
      "url": "https://www.linkedin.com/company/yourcompany"
    }
  ]
}
```

You can add, remove, or modify social links as needed. Each link requires a `name` (display text) and `url` (link destination).

## Deployment

This site automatically deploys to GitHub Pages when you push to the main branch.

## License

MIT
