# Local RAG AI System (Beginner Friendly)

![Version](https://img.shields.io/badge/version-1.0.1-blue)
![Docker](https://img.shields.io/badge/docker-required-blue)
![Node](https://img.shields.io/badge/node.js-20+-green)
![License](https://img.shields.io/badge/license-MIT-green)
![Beginner Friendly](https://img.shields.io/badge/beginner-friendly-success)

A **small local Retrieval Augmented Generation (RAG) AI system** designed for learning, experimentation, and understanding how modern AI systems work.

The system runs **entirely locally using Docker**, embeds your own files into a vector database, and allows a local LLM to answer questions based on those files.

The goal of this project is **simplicity and transparency**, so you can easily understand and extend the system.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                           local RAG AI-System                                 │
│                                                                               │
│  User                                                                         │
│   │                                                                           │
│   │ user prompt                                                               │
│   ▼                                                                           │
│  ┌───────────────┐                                                            │
│  │   Retriever   │                                                            │
│  │               │                                                            │
│  │  - similarity │─────── search ───────────────┐                             │
│  │    search     │                              │                             │
│  └───────┬───────┘                              ▼                             │
│          │                               ┌──────────────┐                     │
│          │ actual prompt / context       │   Qdrant DB  │                     │
│          ▼                               │  (Vector DB) │                     │
│  ┌───────────────┐                       └──────┬───────┘                     │
│  │   LLM         │                              │                             │
│  │ (chat model)  │                              │                             │
│  └───────────────┘                              │                             │
│          ▲                                      │                             │
│          │ running models                       │ embed files                 │
│  ┌───────────────┐                              ▼                             │
│  │ Docker Model  │                     ┌─────────────────┐                    │
│  │    Runner     │                     │   Embedding     │                    │
│  └───────────────┘                     │     Service     │                    │
│                                        │                 │                    │
│                                        │ uses embedding  │                    │
│                                        │ LLM model       │                    │
│                                        └───────┬─────────┘                    │
│                                                │                              │
│                                                │ takes files                  │
│                                                ▼                              │
│                                            ┌─────────┐                        │
│                                            │  Files  │                        │
│                                            └─────────┘                        │
│                                                                               │
│  Docker Containers                                                            │
│  ├─ retriever container → chat + retrieval                                    │
│  ├─ embedder container  → indexing + embeddings                               │
│  └─ qdrant container  → vector database                                       │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

# Explanation of the System

This project implements a **basic RAG pipeline**.

RAG stands for **Retrieval Augmented Generation**, meaning the AI does not rely only on its training data. Instead, it retrieves relevant information from your own files and uses that information to generate an answer.

The workflow looks like this:

1. **User asks a question**
2. The system **searches similar content** in a vector database
3. The **relevant context is added to the prompt**
4. The **LLM generates an answer using that context**

Your personal files become the **knowledge base** of the system.

---

## Project Structure

```
.
├── compose.yml        # Docker Compose configuration (containers, models, configs)
├── Dockerfile         # Build instructions for retriever/embedder containers
├── index.js           # Retriever application (chat + retrieval)
├── embedder.js        # Embedder service (background indexing loop)
├── package.json       # Node.js dependencies
│
├── data/              # Knowledge base (files to embed into the vector DB)
├── upload/            # One-time prompt uploads consumed via /upload
│
├── README.md          # Project documentation
├── NEXTSTEPS.md       # Ideas and roadmap for improving the system
├── PROMPTS.md         # Notes about prompts and prompt engineering
```

---

# System Architecture

The system consists of several components:

### User

The user interacts with the system via the terminal.

You can ask questions about the data stored in the knowledge base.

---

### Data Sources (Knowledge Base)

Files placed inside the `data/` directory are used as knowledge sources.

Currently supported formats:

```
.md
.txt
```

These files are:

1. Read by the system
2. Split into chunks
3. Embedded into vectors
4. Stored in a vector database

---

### Embedding Model

The embedding model converts text into **vector embeddings**.

Vectors are numerical representations of meaning.

Example:

```
"How to install Docker"
→ embedding vector
```

These vectors are stored in the database and used for **similarity search**.

---

### Vector Database (Qdrant)

The system uses **Qdrant** as a vector database.

Qdrant stores:

* text chunks
* embeddings
* metadata

When the user asks a question, the system:

1. Converts the question into an embedding
2. Searches the database for similar vectors
3. Returns the most relevant pieces of text

---

### Retriever

The retriever is responsible for:

* searching the vector database
* selecting the best matching chunks
* injecting them into the prompt as **context**

This is what enables the AI to answer based on your data.

---

### LLM (Chat Model)

The LLM generates the final answer.

It receives:

```
User Prompt
+ Retrieved Context
+ System Instructions
```

Then it produces a structured response.

The default model used is:

```
Qwen2.5-Coder-3B-Instruct
```

via Docker Model Runner.

---

# Docker in this Project

Docker is used to **containerize the system**.

This means every component runs in an isolated environment.

Benefits:

* easy installation
* no dependency conflicts
* reproducible environment
* simple startup

This project uses **Docker Compose** to orchestrate multiple services.

Containers used:

| Container | Purpose                                            |
| --------- | -------------------------------------------------- |
| `retriever` | Interactive assistant (retrieval + answering) |
| `embedder`  | Background indexing and embedding worker |
| `qdrant`  | Vector database                                    |

Docker also runs the **LLM models** through Docker Model Runner.

---

# Installation

## Prerequisites

You need the following software installed:

* **Docker**
* **Docker Compose**
* **Git (optional)**

Recommended system:

```
8GB RAM minimum
16GB recommended
```

CPU-only usage works.

---

## Install the System

### 1. Clone or download the project

```
git clone <your-repo>
cd <repo>
```

Or simply download the files and extract them.

---

### 2. Add your knowledge files

Place your files inside:

```
./data
```

Example:

```
data/
  docker.md
  networking.md
  rag_notes.txt
```

Optional one-time upload files (used only with `/upload <prompt>`):

```
upload/
  incident-notes.md
  todo.txt
```

After `/upload` is used, consumed `.md` and `.txt` files are removed from `upload/`.

Because `./upload` is bind-mounted into the retriever container as `/app/upload`, users can drop files in from the host machine directly.

---

### 3. Build the containers

```
docker compose build
```

Optional clean rebuild:

```
docker compose build --no-cache
```

---

### 4. Start the system

```
docker compose up -d
```

This will start:

* the application container
* the Qdrant database

---

# Usage

## Start the System

If the containers are not running:

```
docker compose up -d
```

---

## Stop the System

To shut everything down:

```
docker compose down
```

---

## Update / Change the System

If you modify the code or configuration:

```
docker compose build
docker compose up -d
```

If models or dependencies changed:

```
docker compose build --no-cache
```

---

## Use the AI System

Start both services:

```
docker compose up -d retriever embedder qdrant
```

Open the interactive retriever shell:

```
docker compose exec retriever /bin/bash
```

Monitor background embedding:

```
docker compose logs -f embedder
```

You can now interact with the retriever.

Example:

```
What is Docker?
Explain RAG.
Summarize the file docker.md
```

---

### Exit the Chat

Inside the chat:

```
/bye
```

Then exit the container shell:

```
exit
```

---

# Configuration

Important configuration values are inside:

```
compose.yml
```

Examples:

### Similarity Search

```
MAX_SIMILARITIES
COSINE_LIMIT
```

These control how many relevant chunks are retrieved.

---

### Model Parameters

Examples:

```
OPTION_TEMPERATURE
OPTION_TOP_P
OPTION_PRESENCE_PENALTY
```

These influence the LLM behavior.

---

### Global Guardrails

Located in:

```
compose.yml
guardrails.md
```

These guardrails are always active system rules for retrieval behavior and cannot be overridden by user prompts.

---


# Purpose of this Project

This system is designed to:

* learn how RAG works
* experiment with local AI
* understand vector search
* explore LLM architecture

It is **not meant as a production system**, but as a **playground for experimentation**.