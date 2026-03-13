# Magic Triangle

              /\
             /  \
            /    \
           /      \
          /  Model \
         /__________\
        /            \
       /              \
      /       |        \
     / Prompt | Context \
    /_________|__________\

## Model

> choose the right model for your task/topic

Important:
- look for models to use them (for example *hub.docker.com*)
- take a look at the system requirements (RAM, disk space)
- Watch out for CPU only usage (the system is not optimized for GPU usage but its possible)
- take a look at the token size of the model
- look at the *favorite* task of the model

## Prompt

> use good/better prompts

Components of a good prompt:
- Role (*act as a history teacher*) > who you ask to do the task
- Task (*explain to me ...*) > the more detailled you explain the task the better
- Output (*answer me in ukrainian language, order chonologic, give me a short list of bulletpoints as overview then dive in the details afterwards*) > format for your answer 
- Negative prompt (*don't tell me about ..., don't use ...*) > like rules for the AI

## Context

> provide the right context for the prompt

Components of a good context:
- your situation (*i am a student in the 9th grade, in my history class i need to prepare a short teaching about ...*)
- use of the answer (*in order to decide on my topic for the short teaching i need an overview of the possible topics, ...*) > explain what you will do with the answer