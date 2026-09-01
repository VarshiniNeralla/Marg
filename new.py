class JobApplicationState(TypedDict):
    job_description: str 
    is_suitable: IsSuitableJobEnum
    application: str

analyze_chain = llm | parser

def analyze_job_description(state):
    prompt = prompt_template_enum.format(job_description = state["job_description"])
    result = analyze_chain.invoke(prompt)
    return {"is_suitable": result}


def is_suitable_condition(state):
    return state["is_suitable"] == IsSuitableJobEnum.YES

builder = StateGraph(JobApplicationState)
builder.add_node("analyze_job_description", analyze_job_description)
builder.add_node("generate_application", generate_application)
builder.add_edge(START, "analyze_job_description")
builder.add_conditional_edges(
    "analyze_job_description", is_suitable_condition,
    {True: "generate_application", False: END})
builder.add_edge("generate_application", END)
