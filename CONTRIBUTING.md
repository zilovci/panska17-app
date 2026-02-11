# Contributing to Panská 17 App

Thank you for your interest in contributing to the Panská 17 facility maintenance application!

## Development Workflow

### Setting Up Your Development Environment

1. **Clone the repository**
   ```bash
   git clone https://github.com/zilovci/panska17-app.git
   cd panska17-app
   ```

2. **Start a local server**
   ```bash
   # Option 1: Python
   python -m http.server 8000
   
   # Option 2: Node.js
   npx http-server -p 8000
   ```

3. **Open in browser**
   Navigate to `http://localhost:8000`

### Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
   
   Branch naming conventions:
   - `feature/` - New features
   - `fix/` - Bug fixes
   - `docs/` - Documentation updates
   - `style/` - CSS/styling changes

2. **Make your changes**
   - Edit `index.html` for UI changes
   - Edit `app.js` for functionality
   - Edit `style.css` for custom styles

3. **Test your changes**
   - Test in multiple browsers (Chrome, Firefox, Safari)
   - Test on mobile devices
   - Test the print functionality if you changed layouts
   - Check browser console for errors

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "Type: Brief description of changes"
   ```
   
   Commit message format:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation
   - `style:` - Formatting, styling
   - `refactor:` - Code refactoring
   - `test:` - Adding tests
   - `chore:` - Maintenance tasks

5. **Push your branch**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request**
   - Go to GitHub and create a PR from your branch to `main`
   - Describe your changes clearly
   - Wait for review and approval

### Code Style Guidelines

#### HTML
- Use semantic HTML5 elements
- Maintain consistent indentation (4 spaces)
- Keep attributes in a logical order (id, class, data-*, etc.)
- Use meaningful IDs and class names

#### CSS
- Use Tailwind CSS classes where possible
- Custom styles in `style.css` for print and special cases
- Keep styles organized by component
- Use CSS variables for repeated values

#### JavaScript
- Use modern ES6+ syntax
- Keep functions focused and single-purpose
- Use descriptive variable and function names
- Add comments for complex logic
- Handle errors gracefully
- Use async/await for asynchronous operations

Example:
```javascript
async function fetchData() {
  try {
    const { data, error } = await sb.from('table').select('*');
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error fetching data:', err);
    return null;
  }
}
```

### Testing Checklist

Before submitting a PR, ensure:

- [ ] Code works in Chrome, Firefox, and Safari
- [ ] Mobile layout works correctly
- [ ] No console errors
- [ ] Print/PDF functionality works (if applicable)
- [ ] Photos upload correctly (if applicable)
- [ ] Login/logout works properly (if applicable)
- [ ] All existing features still work
- [ ] Code follows style guidelines

### Working with Supabase

#### Database Changes
If you need to modify the database schema:

1. Make changes in Supabase dashboard
2. Document the changes in your PR
3. Update any affected queries in `app.js`
4. Test thoroughly

#### Storage Changes
For photo storage modifications:

1. Understand the current thumbnail generation process
2. Test with various image sizes and formats
3. Consider storage costs and optimization
4. Document any changes to photo handling

### Common Tasks

#### Adding a New View
1. Add the HTML structure in `index.html`
2. Add navigation button to sidebar
3. Add switch case in `switchView()` function
4. Implement data loading function
5. Style the view
6. Test navigation and data display

#### Adding a New Feature
1. Plan the feature and discuss in an issue
2. Create a feature branch
3. Implement the UI in `index.html`
4. Add functionality in `app.js`
5. Add styles if needed in `style.css`
6. Test thoroughly
7. Document the feature
8. Submit a PR

#### Fixing a Bug
1. Reproduce the bug locally
2. Identify the root cause
3. Create a fix branch
4. Implement the fix
5. Verify the bug is resolved
6. Test for regression
7. Submit a PR with description of the bug and fix

### Performance Considerations

- Minimize database queries
- Use thumbnails for images in lists
- Lazy load images when possible
- Debounce user input handlers
- Cache frequently accessed data
- Optimize image sizes before upload

### Security Best Practices

- Never commit Supabase keys to version control (use environment variables if possible)
- Validate user input
- Use Supabase Row Level Security (RLS) policies
- Sanitize data before display
- Use HTTPS for all connections
- Handle authentication state properly

### Deployment

The app is automatically deployed to Vercel when changes are merged to `main`:

1. Merge PR to main
2. Vercel automatically builds and deploys
3. Check deployment status on Vercel dashboard
4. Test the live deployment

### Getting Help

If you need help:
- Check existing issues on GitHub
- Review this documentation
- Look at recent PRs for examples
- Create an issue for questions
- Contact the repository maintainer

### Code Review Process

1. Submit your PR
2. Wait for automated checks (Vercel deployment preview)
3. Address any review comments
4. Make requested changes
5. Wait for approval
6. Merge to main

Thank you for contributing to Panská 17 App! 🏢
