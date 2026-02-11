# Panská 17 - Facility Maintenance Application

A web-based facility maintenance and issue tracking application built with vanilla JavaScript and Supabase.

## Overview

This application helps manage maintenance issues in a building, with features for:
- Dashboard with active and resolved issues
- British Council inspection tracking
- Photo documentation with thumbnail generation
- Issue status updates and history
- Archive functionality
- PDF/Print-friendly reports

## Technology Stack

- **Frontend**: HTML5, CSS3 (Tailwind CSS via CDN), Vanilla JavaScript
- **Backend**: Supabase (Authentication, Database, Storage)
- **Deployment**: Vercel
- **Icons**: Font Awesome 6.4.0

## Getting Started

### Prerequisites

- A web browser (Chrome, Firefox, Safari, Edge)
- Supabase account and project
- Vercel account (for deployment)

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/zilovci/panska17-app.git
   cd panska17-app
   ```

2. Open `index.html` in your web browser or use a local server:
   ```bash
   # Using Python 3
   python -m http.server 8000
   
   # Using Node.js http-server
   npx http-server -p 8000
   ```

3. Navigate to `http://localhost:8000` in your browser

### Configuration

Update the Supabase credentials in `app.js`:
```javascript
const S_URL = 'your-supabase-url';
const S_KEY = 'your-supabase-anon-key';
```

## How to Update the Main Branch

### Method 1: Direct Updates (Small Changes)

For quick fixes or small updates:

1. Make your changes to the files
2. Test locally by opening `index.html` in a browser
3. Commit and push to main:
   ```bash
   git add .
   git commit -m "Description of changes"
   git push origin main
   ```

### Method 2: Feature Branch Workflow (Recommended)

For larger features or changes:

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and test thoroughly

3. Commit your changes:
   ```bash
   git add .
   git commit -m "Add feature: description"
   git push origin feature/your-feature-name
   ```

4. Create a Pull Request on GitHub

5. Review and merge the PR into main

## Common Update Tasks

### Updating Dependencies

The app uses CDN links for dependencies. To update:

1. **Tailwind CSS**: Update the script tag in `index.html`
   ```html
   <script src="https://cdn.tailwindcss.com"></script>
   ```

2. **Supabase**: Update in `index.html`
   ```html
   <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
   ```

3. **Font Awesome**: Update in `index.html`
   ```html
   <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
   ```

### Adding New Features

1. Identify where the feature should be added
2. Update the relevant files:
   - `index.html` - for UI elements
   - `app.js` - for functionality
   - `style.css` - for custom styling
3. Test thoroughly in multiple browsers
4. Commit and deploy

### Fixing Bugs

1. Identify the issue
2. Reproduce the bug locally
3. Fix the issue in the relevant file
4. Test the fix
5. Commit and deploy

## Database Schema

The app uses Supabase with the following tables:
- `issues` - Main issue tracking
- `issue_updates` - Status updates and timeline
- `locations` - Building locations/rooms

## Deployment

The app is automatically deployed to Vercel when changes are pushed to the main branch.

### Manual Deployment

If you need to deploy manually:

1. Push your changes to GitHub
2. Vercel will automatically build and deploy
3. Check the deployment status in your Vercel dashboard

## File Structure

```
panska17-app/
├── index.html      # Main HTML file with all UI components
├── app.js          # Application logic and Supabase integration
├── style.css       # Custom styles and print styles
└── README.md       # This file
```

## Features

### Photo Management
- Upload photos with automatic thumbnail generation
- Optimized thumbnails (420px width, 55% quality)
- Full-size images stored in Supabase storage

### Issue Tracking
- Create and update maintenance issues
- Track status changes over time
- Archive completed issues
- Filter by location, status, date

### Reporting
- Generate printable reports
- Photo documentation in timeline
- Date-stamped updates

## Support and Maintenance

### Updating Supabase Schema
If you need to modify the database:
1. Go to your Supabase project dashboard
2. Use the SQL editor to run migrations
3. Update the app code to match schema changes

### Backup
Regular backups are handled by Supabase. You can also:
- Export data from Supabase dashboard
- Use Supabase CLI for automated backups

## Tips for Development

1. **Testing**: Always test changes in multiple browsers
2. **Mobile**: The app is mobile-responsive - test on mobile devices
3. **Print**: Test the print functionality when making layout changes
4. **Photos**: Test with various image sizes and formats
5. **Offline**: The app requires internet for Supabase connection

## Troubleshooting

### Login Issues
- Check Supabase credentials in `app.js`
- Verify Supabase project is active
- Check browser console for errors

### Photo Upload Failures
- Check Supabase storage bucket permissions
- Verify photo size is reasonable (<10MB)
- Check browser console for errors

### Deployment Issues
- Check Vercel build logs
- Ensure all files are committed
- Verify no build errors

## License

[Add your license information here]

## Contact

For questions or issues, please contact the repository owner.
