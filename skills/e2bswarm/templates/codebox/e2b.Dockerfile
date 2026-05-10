# E2B Codebox Template
# Pre-configured sandbox with Claude Code CLI installed

FROM e2bdev/code-interpreter:latest

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && \
    apt-get install -y gh

# Setup workspace directory
RUN mkdir -p /home/user/workspace && \
    chown -R user:user /home/user/workspace

# Configure git defaults
RUN git config --global user.email "swarm@e2b.dev" && \
    git config --global user.name "E2B Swarm" && \
    git config --global init.defaultBranch main

# Setup SSH directory for GitHub auth
RUN mkdir -p /home/user/.ssh && \
    chmod 700 /home/user/.ssh && \
    ssh-keyscan github.com >> /home/user/.ssh/known_hosts 2>/dev/null && \
    chown -R user:user /home/user/.ssh

WORKDIR /home/user/workspace
