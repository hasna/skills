---
name: skill-googledrive
description: Manage Google Drive files and folders. Upload, download, search, share files, create folders, and manage permissions. Use when working with Google Drive storage, file sharing, or document management.
---

# Google Drive Management Skill

## What this Skill does

This Skill provides comprehensive Google Drive file and folder management capabilities through the Google Drive API.

## When to use this Skill

Use this Skill when you need to:
- Upload files to Google Drive
- Download and access Drive files
- Search for files and folders
- Create and organize folders
- Share files and manage permissions
- Move and rename files
- Delete or trash files
- Get file metadata and information
- List folder contents
- Manage Drive storage

## MCP Server Connection

The Google Drive MCP server provides access to your Drive storage.

### NPM Package
```json
{
  "googledrive": {
    "command": "npx",
    "args": ["-y", "mcp-googledrive"],
    "env": {
      "GDRIVE_CREDS_DIR": "/path/to/credentials",
      "CLIENT_ID": "your-client-id",
      "CLIENT_SECRET": "your-client-secret"
    }
  }
}
```

### Local Installation
```json
{
  "googledrive": {
    "command": "node",
    "args": ["/path/to/mcp-googledrive/dist/index.js"],
    "env": {
      "GDRIVE_CREDS_DIR": "/path/to/credentials",
      "CLIENT_ID": "your-client-id",
      "CLIENT_SECRET": "your-client-secret"
    }
  }
}
```

**Setup**:
1. Create OAuth credentials in Google Cloud Console
2. Enable Google Drive API
3. Store credentials in specified directory

## Available Operations

The Google Drive MCP server provides tools for:

- **File Upload**: Upload files to Drive with metadata
- **File Download**: Download files by ID or path
- **File Search**: Search by name, type, or content
- **Folder Management**: Create, list, and organize folders
- **Permissions**: Share files and manage access
- **File Operations**: Move, rename, copy, delete files
- **Metadata**: Get file info, properties, and details
- **Trash Management**: Trash and restore files
- **Storage Info**: Check quota and usage

## File Types Supported

Works with all Google Drive file types:
- **Google Docs**: Documents, Sheets, Slides
- **Regular Files**: PDFs, images, videos, archives
- **Folders**: Organize and structure content
- **Shared Drives**: Team and shared storage

## Examples

### Example 1: Upload a file
"Upload the report.pdf to my Google Drive"
→ Claude uploads the file to root or specified folder

### Example 2: Search and download
"Find the Q4 budget spreadsheet and download it"
→ Claude searches Drive and downloads the file

### Example 3: Share a file
"Share the presentation.pptx with team@company.com"
→ Claude sets permissions and shares the file

### Example 4: Organize files
"Create a folder called 'Project X' and move all related docs there"
→ Claude creates folder and moves matching files

### Example 5: Get file info
"What files were modified in the last week?"
→ Claude queries and lists recently modified files

## Best practices

- Use specific file names for accurate search
- Organize with folders for better structure
- Set appropriate permissions when sharing
- Use search queries for large Drive accounts
- Download before processing files locally
- Check storage quota before large uploads
- Use trash instead of permanent deletion
- Leverage Google Workspace file types for collaboration

## Integration Notes

The Google Drive MCP server automatically handles:
- OAuth authentication and token refresh
- File upload with chunking for large files
- File type detection and MIME types
- Permission management and ACLs
- Folder hierarchy and paths
- Search query optimization
- Rate limiting and quotas
- Error handling and retries

## Permissions Management

Support for:
- **Reader**: View-only access
- **Commenter**: Can comment on files
- **Writer**: Full edit access
- **Owner**: Transfer ownership
- **Anyone with link**: Public sharing
- **Specific users**: Email-based sharing
