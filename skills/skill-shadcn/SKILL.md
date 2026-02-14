---
name: skill-shadcn
description: Manage shadcn/ui components and component registry. Add, update, and configure UI components, search the registry, and manage component dependencies. Use when working with shadcn/ui components in React/Next.js projects.
---

# shadcn/ui Component Management Skill

## What this Skill does

This Skill provides capabilities for managing shadcn/ui components in your React or Next.js projects through the shadcn CLI and component registry.

## When to use this Skill

Use this Skill when you need to:
- Add shadcn/ui components to your project
- Browse the component registry
- Search for specific components
- View component examples and usage
- Update existing components
- Configure component styling (CSS variables, colors)
- Manage component dependencies
- Initialize shadcn/ui in a new project

## MCP Server Connection

The shadcn MCP server provides access to the component registry and CLI.

```json
{
  "shadcn": {
    "command": "npx",
    "args": ["shadcn@latest", "mcp"]
  }
}
```

**No API key required**

## Available Operations

The shadcn MCP server provides tools for:

- **Component Registry**: Browse and search available components
- **Component Addition**: Add components to your project
- **Component Updates**: Update existing components
- **Configuration**: Manage colors, styling, and theming
- **Examples**: View component usage examples
- **Dependencies**: Handle component dependencies automatically
- **Project Init**: Initialize shadcn/ui in new projects

## Available Components

shadcn/ui includes 50+ components:
- **Layout**: Card, Separator, Tabs, ScrollArea
- **Forms**: Input, Button, Select, Checkbox, Radio
- **Data Display**: Table, Avatar, Badge, Progress
- **Feedback**: Alert, Toast, Dialog, Sheet
- **Navigation**: NavigationMenu, Breadcrumb, Pagination
- **Overlay**: Popover, Tooltip, DropdownMenu, ContextMenu
- And many more...

## Styling Options

Components support:
- **Default theme**: Clean, modern design
- **New York theme**: Alternative styling
- **CSS Variables**: Customizable colors
- **Tailwind CSS**: Full Tailwind integration
- **Dark mode**: Built-in dark mode support

## Examples

### Example 1: Add a component
"Add the shadcn Button component to my project"
→ Claude adds the button component with all dependencies

### Example 2: Add multiple components
"Add Dialog, Sheet, and Dropdown components"
→ Claude installs all three components

### Example 3: Search components
"What shadcn components are available for forms?"
→ Claude lists form-related components

### Example 4: View examples
"Show me examples of using the shadcn DataTable"
→ Claude retrieves usage examples and demos

### Example 5: Initialize project
"Set up shadcn/ui in this Next.js project with the New York theme"
→ Claude initializes shadcn with specified configuration

## Best practices

- Initialize shadcn/ui before adding components
- Use TypeScript for better type safety
- Customize colors via CSS variables
- Install related components together (e.g., Dialog + Button)
- Check examples for proper usage patterns
- Keep components updated regularly
- Use the default or New York theme consistently
- Configure Tailwind properly for styling

## Integration Notes

The shadcn MCP server automatically handles:
- Component file generation
- Dependency resolution and installation
- TypeScript type definitions
- Tailwind CSS configuration
- CSS variable setup
- Component utilities and helpers
- Registry synchronization
