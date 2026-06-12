Let's start moving our harness towards an RLM style. 

The key change we'll make first is that our agent will not directly interact with user input. Instead we will give it a pyodide repl poulated with details it may programmatically inspect, via a `repl` tool it may invoke which takes in a python string to execute in the repl, and returns 

What we'll implement in this pass is having the agent interact via the repl, and the basics of how it can interact with the context programmatically and return results.

## RLM/repl mechanics

### Interacting with context

The repl  provide a `context` value which is either a string prompt or a dict structure.

### Turn initialisation and interacting with context

When an agent starts its turn, the repl will be initialised with a special variable `context`, which is either a string prompt or a dict structure.

In the initial message provided to the agent, it will be automatically provided with repl outputs showing the first 500 and last 500 characters of the prompt, if it a string, and the top level keys with truncated previews (to 500 character) of values if it is a dict. The agent may then choose to interact with the `context` variable via slices or string manipulation/regex functions.

We want to avoid the agent spending tokens always reading the whole prompt directly as it may be large, so at the pyodide level we would like to limit the agent to reading at most 500 characters at a time from the prompt.

### Providing a final output

When ending its turn, the agent should doo so by providing its response to the repl via one of two special finalisation functions.

The `FINAL('output string')` function will provide a direct string literal as the final output from the agent.

The `FINAL_VAR(some_var)` string will provide as the final output the value of the given variable (which may be a string but could also be e.g. a dict or structure value). This can allow the agent to provide a programmatically-generated output without having to read its full representation into its context window.

At the harness level, these values will be presented to the user as the final output.

If an agent ends its turn without providing a final output, it should be re-invoked to continue.

### Tools

At first, we will just provide the agent with the repl tool, we will leave out our prior read file support for now.

### System prompt

We will provide a system prompt to the agent which concisely explains how it works, what is available in its repl environment, emphasises that it must use the repl whenever it wants to interact with context, the user or tools and which ensures that when it is done, it produces a final output via the FINAL/FINAL_VAR mechanism.

## UX

For visibility to the user, in our harness output we should show the final result value, but also agent thinking and its repl commands in a grey font to delineate from the final result.
