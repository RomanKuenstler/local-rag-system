# Possible Next-Steps
## Improve User-Prompt and Context

> see the file *PROMPTS.md*

## Improve System-Prompt

> improve System-Prompt (compose.yml > config)

Use ChatGPT (or other AIs) to help you to write better System-Prompts
- optimize for RAG
- optimize for specific Task (or knowledge)

## Improve you data

> improve your data-sources/files that you give the system

For example:
- multiple files about the same topic
- prepare your files for easier chunking (at the moment the system creates the chunks based on headlines in the .md files)
- use detailled files not just bulletpoints

Also you can ask ChatGPT (or other AIs) for ideas *how to improve your data-sources for a local RAG*

## Improve Similarities

> improve the searching for matches in the DB (thats called similarities)

Use ChatGPT (or other AIs) to help you to improve the code (index.js) to search for similarities
For example:
- always at least 5 similarities (when less > no answer)
- better score of the similarities (example: higher than 0.7; when lower > no answer)

## Improve Chunking

> improve the creation of chunks from your input files 
> smaller and better (semantic) chunks will also improve the similarities and so the answer

Use ChatGPT (or other AIs) to help you to improve the code (index.js) to create better Chunks
Sections in the code:
- CHUNKS
- HELPER

Examples for improving:
- use semantic creation of chunks
- use smaller chunks

## Improve Embedding

> improve the embedding (insert data into DB) process

Use ChatGPT (or other AIs) to help you to improve the code (index.js) for embedding data
For example:
- some meta data is already included but there is still ways to improve this
- multiple embeddings (different ways of embedding for the same source > better answer; like multiple was of remembering)
- some mechanism to only embed new and changed files are already implemented but there is still ways to improve this
- remove data/knowledge from the DB

## Additional File-Extensions

> enable the system to use other file extensions to embed into the DB

Use ChatGPT (or other AIs) to help you to improve the code (index.js) for embedding other file extensions
For example:
- .pdf > search/ask for *javascript embed pdf into rag*
- .docx > search/ask for *javascript embed .docx into rag*

> for the beginning focus only on **text** embedding
> enable you system to also embed for example images is more difficult (but also possbile)

##  Split up Application

> it's recommended to split up the system, especially the application (index.js) into two different parts
>
> 1 - the retriever > this is the application the user talks to and that's responsible for searching similarities etc
> 2 - the embedding > this is the process of embedding your files/sources into the DB

Use ChatGPT (or other AIs) to help you to split up the code (index.js) into retriever and embedding in own files. And step two is then to also create two separate (docker) containers for this. Here you can also use ChatGPT to help you to modify the compose.yml and Dockerfile for this > that's a easy task, but it highly improves your system

## External Data-Sources

> you can use external data-sources like websites/weburl for your RAG

Use ChatGPT (or other AIs) to help you to improve the code (index.js) to also use external data-sources
For example:
- weburls > search/ask for *javascript embed weburls into rag*

## Improve LLM with parameters

> you can optimize your LLM (chat-model) with some small configurations

Use ChatGPT (or other AIs) to help you to optimize your model.
For example (already implemented):
- OPTION_TEMPERATURE: 0.0
- OPTION_TOP_P: 0.9
- OPTION_PRESENCE_PENALTY: 2.2

But of course there are way mor options like this and other ways to optimize you LLM. 

> check the documentation of the LLM (chat-model), search in google and ask ChatGPT (or other AIs) about this topic

# Advanced Topics for later Steps
## MCP Servers

> you can add MCP-Servers to the AI-System
> MCP-Servers are like a instruction manual for an AI how to use a specific tool/task

For example:
- use an MCP-Server for Filesystem (so your AI-System can understand and use your Filesystem)
- use an MCP-Server for Time (so your AI-System understands Timeones etc)
- more advanced > MCP-Server for OPNsense or other Tools

## Chain of Systems / Agents

> you can create a chain of *Tasks* inside you system (or also add more systems)
> create agents each optimized for only one specific task (you can then also chain them after each other)

Usefull searches:
- ai chains/workflows/pipelines
- local Agents
- N8N (tool for visually create workflows or agents)

## Multiple DBs

> you could use multiple DBs each for just a specific topic

## Multiple/Other LLMs

> you could use multiple or other LLMs each for a specific task/topic

Usefull sources:
- Docker Model Runner
- Ollama

## UI

> you can add a UI (for example Web-UI) to the system instead of just using the terminal

Usefull examples:
- openwebui
- oobabooga/text-generation-webui

## Authentication

> you can add authentication to you AI-System (with and/or without a UI)

For example:
- just create your own small local authentication service (use the help of ChatGPT)
- integrate with existing authentication tools (like Keycloak, Authentik)
- integration with LDAP/Active Directory

## Permissions / Authorisation

> you can add permissions to your authentication service

For example:
- create it on your own
- use existing tools or integration (like the examples on *Authentication*)

## Image embedding

> use images for embedding into you DB

For this task it's not enough to just analyse and embed the image, then the ai will only know what was inside the image and maybe can describe it. What you want to do is:
- analyse and embed the image
- store the source image so that the system can access it
- link the embedded information to the source image so that the sytem knows which image the information was from
- enable the system to also use the actual image in the answer

> use the help of ChatGPT (or other AIs) for this and also read about Image embedding into RAGs

### Video embedding

Of course you can also embedd videos (without audio) into the system. Basically this is pretty similar to image embedding

> use the help of ChatGPT (or other AIs) for this

### Audio embedding

Embedding of Audio files or videos with audio is also possible. For this task you at first have to somehow transcribe the audio into text (important to include timestamps) and then you can simply embed this text in the normal way. In case of videos of course you also want to do the Image/Video embedding, store the video, link the video inside the embedding (DB) and enable the system to use them inside their answer.

> use the help of ChatGPT (or other AIs) for this

## File user input

> enable users to also import files into their user prompt

For this you have to create a way for users to upload files into the prompt, enable your system to analyse the uploaded files in order to use them inside the user prompt.

> use the help of ChatGPT (or other AIs) for this, its easier than you think
> 
> **Important:**
> do this only for one specific file extension at a time, and its recommended to start with easy ones like .md or .txt and then step-by-step you can add more file extenstions (even images etc)

## Web-Research

> enable your system to do actual web research

That's espacially usefull when your system doesn't find the needed information/knowledge in the DB to answer your user prompt. In this case you could implement a answer of the system like *Sorry i don't have the needed knowledge about this topic. Please provide me necessary input for this. If you like me to do so, i could also do a web research about this topic - should i do this?* , and if you allow the ai to do so then perform a webresearch for this topic just this one time.

> use the help of ChatGPT (or other AIs) for this, its easier than you think
>
> **Attention** that's not recommended in military use cases, only for private playing around