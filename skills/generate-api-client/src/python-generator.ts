import { openApiTypeToPython } from "./type-mappers";
import type { GenerateOptions, OpenAPISpec, PathItem } from "./types";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function pythonMethodName(path: string, method: string, operation: PathItem) {
  return operation.summary?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() ||
    `${method}_${path.split("/").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

function generateModels(spec: OpenAPISpec) {
  let modelsContent = `"""Pydantic models for ${spec.info.title}"""\n\n`;
  modelsContent += `from typing import Any, Optional, List, Dict, Literal\n`;
  modelsContent += `from datetime import datetime, date\n`;
  modelsContent += `from pydantic import BaseModel\n\n`;

  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      if (schema.description) {
        modelsContent += `class ${name}(BaseModel):\n`;
        modelsContent += `    """${schema.description}"""\n`;
      } else {
        modelsContent += `class ${name}(BaseModel):\n`;
      }

      if (schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          const required = schema.required?.includes(propName);
          const pyType = openApiTypeToPython(propSchema);
          modelsContent += `    ${propName}: ${required ? pyType : `Optional[${pyType}]`}${required ? "" : " = None"}\n`;
        }
      } else {
        modelsContent += `    pass\n`;
      }
      modelsContent += `\n`;
    }
  }

  return modelsContent;
}

function appendSyncEndpoint(clientContent: string, path: string, method: string, operation: PathItem) {
  const methodName = pythonMethodName(path, method, operation);
  const pathParams = operation.parameters?.filter((param) => param.in === "path") || [];
  const queryParams = operation.parameters?.filter((param) => param.in === "query") || [];
  const hasBody = operation.requestBody && method !== "get";

  clientContent += `    def ${methodName}(self`;

  pathParams.forEach((param) => {
    clientContent += `, ${param.name}: ${openApiTypeToPython(param.schema)}`;
  });

  queryParams.forEach((param) => {
    const pyType = openApiTypeToPython(param.schema);
    clientContent += `, ${param.name}: ${param.required ? pyType : `Optional[${pyType}]`}${param.required ? "" : " = None"}`;
  });

  if (hasBody) {
    clientContent += `, data: Optional[Dict[str, Any]] = None`;
  }

  clientContent += `) -> Any:\n`;
  clientContent += `        """${operation.description || operation.summary || `${method.toUpperCase()} ${path}`}"""\n`;
  clientContent += `        path = "${path}"\n`;

  pathParams.forEach((param) => {
    clientContent += `        path = path.replace("{${param.name}}", str(${param.name}))\n`;
  });

  if (queryParams.length > 0) {
    clientContent += `        params = {}\n`;
    queryParams.forEach((param) => {
      clientContent += `        if ${param.name} is not None:\n`;
      clientContent += `            params["${param.name}"] = ${param.name}\n`;
    });
    clientContent += `        return self._request("${method.toUpperCase()}", path, params=params`;
  } else {
    clientContent += `        return self._request("${method.toUpperCase()}", path`;
  }

  if (hasBody) {
    clientContent += `, json=data`;
  }

  clientContent += `)\n\n`;
  return clientContent;
}

function appendAsyncEndpoint(clientContent: string, path: string, method: string, operation: PathItem) {
  const methodName = pythonMethodName(path, method, operation);
  const pathParams = operation.parameters?.filter((param) => param.in === "path") || [];
  const queryParams = operation.parameters?.filter((param) => param.in === "query") || [];
  const hasBody = operation.requestBody && method !== "get";

  clientContent += `    async def ${methodName}_async(self`;

  pathParams.forEach((param) => {
    clientContent += `, ${param.name}: ${openApiTypeToPython(param.schema)}`;
  });

  queryParams.forEach((param) => {
    const pyType = openApiTypeToPython(param.schema);
    clientContent += `, ${param.name}: ${param.required ? pyType : `Optional[${pyType}]`}${param.required ? "" : " = None"}`;
  });

  if (hasBody) {
    clientContent += `, data: Optional[Dict[str, Any]] = None`;
  }

  clientContent += `) -> Any:\n`;
  clientContent += `        """${operation.description || operation.summary || `${method.toUpperCase()} ${path}`} (async)"""\n`;
  clientContent += `        path = "${path}"\n`;

  pathParams.forEach((param) => {
    clientContent += `        path = path.replace("{${param.name}}", str(${param.name}))\n`;
  });

  if (queryParams.length > 0) {
    clientContent += `        params = {}\n`;
    queryParams.forEach((param) => {
      clientContent += `        if ${param.name} is not None:\n`;
      clientContent += `            params["${param.name}"] = ${param.name}\n`;
    });
    clientContent += `        return await self._request_async("${method.toUpperCase()}", path, params=params`;
  } else {
    clientContent += `        return await self._request_async("${method.toUpperCase()}", path`;
  }

  if (hasBody) {
    clientContent += `, json=data`;
  }

  clientContent += `)\n\n`;
  return clientContent;
}

function generatePythonClientFile(spec: OpenAPISpec, options: GenerateOptions, className: string, baseUrl: string) {
  let clientContent = `"""${spec.info.title} API Client"""\n\n`;
  clientContent += `from typing import Any, Optional, Dict\n`;
  clientContent += `import requests\n`;
  if (options.async) {
    clientContent += `import aiohttp\n`;
  }
  clientContent += `\n`;

  clientContent += `class ${className}:\n`;
  clientContent += `    """API client for ${spec.info.title}"""\n\n`;
  clientContent += `    def __init__(self, base_url: str = "${baseUrl}", `;

  if (options.auth === "bearer") {
    clientContent += `token: Optional[str] = None, `;
  } else if (options.auth === "apikey") {
    clientContent += `api_key: Optional[str] = None, `;
  }

  clientContent += `timeout: int = 30):\n`;
  clientContent += `        self.base_url = base_url\n`;
  clientContent += `        self.timeout = timeout\n`;

  if (options.auth === "bearer") {
    clientContent += `        self.token = token\n`;
  } else if (options.auth === "apikey") {
    clientContent += `        self.api_key = api_key\n`;
  }

  clientContent += `        self.session = requests.Session()\n`;
  clientContent += `        self._setup_headers()\n\n`;

  clientContent += `    def _setup_headers(self) -> None:\n`;
  clientContent += `        """Setup default headers"""\n`;
  clientContent += `        self.session.headers.update({"Content-Type": "application/json"})\n`;

  if (options.auth === "bearer") {
    clientContent += `        if self.token:\n`;
    clientContent += `            self.session.headers.update({"Authorization": f"Bearer {self.token}"})\n`;
  }

  clientContent += `\n`;

  if (options.sync) {
    clientContent += `    def _request(self, method: str, path: str, **kwargs) -> Any:\n`;
    clientContent += `        """Make HTTP request"""\n`;
    clientContent += `        url = f"{self.base_url}{path}"\n`;
    clientContent += `        response = self.session.request(method, url, timeout=self.timeout, **kwargs)\n`;
    clientContent += `        response.raise_for_status()\n`;
    clientContent += `        return response.json()\n\n`;
  }

  if (options.async) {
    clientContent += `    async def _request_async(self, method: str, path: str, **kwargs) -> Any:\n`;
    clientContent += `        """Make async HTTP request"""\n`;
    clientContent += `        url = f"{self.base_url}{path}"\n`;
    clientContent += `        async with aiohttp.ClientSession() as session:\n`;
    clientContent += `            async with session.request(method, url, timeout=self.timeout, **kwargs) as response:\n`;
    clientContent += `                response.raise_for_status()\n`;
    clientContent += `                return await response.json()\n\n`;
  }

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!HTTP_METHODS.includes(method)) continue;
      if (options.sync) {
        clientContent = appendSyncEndpoint(clientContent, path, method, operation);
      }
      if (options.async) {
        clientContent = appendAsyncEndpoint(clientContent, path, method, operation);
      }
    }
  }

  return clientContent;
}

function generatePythonReadme(spec: OpenAPISpec, options: GenerateOptions, clientName: string, className: string, baseUrl: string) {
  let readme = `# ${spec.info.title} API Client\n\n`;
  readme += `${spec.info.description || "Generated Python API client"}\n\n`;
  readme += `## Installation\n\n\`\`\`bash\npip install requests pydantic\n\`\`\`\n\n`;
  if (options.async) {
    readme += `For async support:\n\`\`\`bash\npip install aiohttp\n\`\`\`\n\n`;
  }
  readme += `## Usage\n\n\`\`\`python\nfrom ${clientName} import ${className}\n\n`;
  readme += `client = ${className}(base_url="${baseUrl}"`;
  if (options.auth === "bearer") {
    readme += `, token="your-token"`;
  }
  readme += `)\n\n`;
  readme += `# Use the client\ndata = client.some_method()\n\`\`\`\n`;

  return readme;
}

export function generatePythonClient(spec: OpenAPISpec, options: GenerateOptions): Record<string, string> {
  const files: Record<string, string> = {};
  const clientName = options.name || spec.info.title.replace(/[^a-zA-Z0-9]/g, "");
  const className = clientName.charAt(0).toUpperCase() + clientName.slice(1) + "Client";
  const baseUrl = options.baseUrl || spec.servers?.[0]?.url || "";

  files["__init__.py"] = `"""${spec.info.title} API Client"""\n\nfrom .client import ${className}\n\n__all__ = ["${className}"]\n`;
  files["models.py"] = generateModels(spec);
  files["client.py"] = generatePythonClientFile(spec, options, className, baseUrl);
  files["README.md"] = generatePythonReadme(spec, options, clientName, className, baseUrl);

  return files;
}
