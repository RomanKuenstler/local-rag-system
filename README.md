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
│  ├─ expert container  → retriever + embedding logic                           │
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
├── Dockerfile         # Build instructions for the "expert" container
├── index.js           # Main application (retriever + embedding logic)
├── package.json       # Node.js dependencies
│
├── data/              # Knowledge base (files to embed into the vector DB)
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
| `expert`  | The main application (retriever + embedding logic) |
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

Open the application container:

```
docker compose exec expert /bin/bash
```

Start the AI:

```
node index.js
```

You can now interact with the system.

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

### System Prompt

Located in:

```
compose.yml
system.instructions.md
```

This prompt controls how the AI answers.

---


# Purpose of this Project

This system is designed to:

* learn how RAG works
* experiment with local AI
* understand vector search
* explore LLM architecture

It is **not meant as a production system**, but as a **playground for experimentation**.