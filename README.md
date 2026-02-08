# Miswag Engineering Blog

The official engineering blog for [Miswag](https://miswag.com/en/), built with Next.js and deployed on GitHub Pages.

## Features

- Markdown-based articles (write in Notion, export as Markdown)
- Clean, responsive design with dark mode support
- Article filtering by category and keyword search
- Team member profiles with LinkedIn links
- Static site generation for fast loading

## Project Structure

```
miswag.engineering/
├── app/                      # Next.js App Router pages
│   ├── articles/[id]/        # Dynamic article pages
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Home page
├── components/               # React components
│   └── ui/                   # shadcn/ui components
├── lib/                      # Utilities and data fetching
├── hooks/                    # Custom React hooks
├── public/
│   ├── content/              # JSON configuration files
│   │   ├── site.json         # Site title and bio
│   │   ├── articles.json     # Article metadata
│   │   ├── categories.json   # Article categories
│   │   ├── team.json         # Team member profiles
│   │   ├── about.json        # About page content
│   │   └── footer.json       # Footer and social links
│   ├── data/                 # Article markdown files and images
│   ├── avatars/              # Team member avatars
│   ├── logo.png
│   └── favicon.png
└── .github/workflows/        # GitHub Actions deployment
```

## Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## Adding Content

### Adding a New Article

1. **Write your article in Notion** and export it as Markdown.

2. **Create the article directory** under `public/data/`:

   ```bash
   mkdir public/data/my-new-article
   ```

3. **Move the exported files:**
   - Rename the exported `.md` file to `index.md`.
   - Move `index.md` and any images folder into `public/data/my-new-article/`.

4. **Add a cover image** for the article card:

   ```
   public/data/my-new-article/cover.png
   ```

5. **Register the article** in `public/content/articles.json`:

   ```json
   {
     "article_id": "my-new-article",
     "article_title": "My Article Title",
     "author_team_id": 1,
     "category_id": 1,
     "article_created_at": "2026-01-15",
     "article_keywords": ["keyword1", "keyword2"],
     "article_description": "Brief description of the article.",
     "article_directory": "my-new-article",
     "featured_image": "cover.png"
   }
   ```

   > Use `team.json` to find the correct `author_team_id` and `categories.json` for the `category_id`. Add new entries if needed.

### Adding a New Team Member

1. Add an avatar image to `public/avatars/`.

2. Add the member to `public/content/team.json`:

   ```json
   {
     "team_id": 4,
     "team_member_name": "Full Name",
     "team_member_position": "Position Title",
     "team_member_linkedin": "https://www.linkedin.com/in/username/",
     "team_member_avatar": "avatar.png",
     "team_member_bio": "Short bio about the team member."
   }
   ```

### Adding a New Category

Add a new entry to `public/content/categories.json`:

```json
{
  "category_id": 5,
  "category_name": "New Category"
}
```

Reference this category in articles using `"category_id": 5`.

## Deployment

The site automatically deploys to GitHub Pages on every push to the `main` branch via GitHub Actions.

## License

MIT
