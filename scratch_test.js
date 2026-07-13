const tc = {
  toolName: 'act',
  input: {
    index: 16,
    action: 'fill',
    value: 'elon musk'
  },
  result: {
    success: true,
    resolvedSelector: ''
  }
};

let finalInput = { ...tc.input };
if (tc.toolName === 'act' && tc.input.index !== undefined) {
  if (tc.result?.resolvedSelector) {
    finalInput.selector = tc.result.resolvedSelector;
  }
}

console.log("finalInput.selector is:", finalInput.selector, "typeof:", typeof finalInput.selector);

let workflowStep = null;

if (tc.toolName === 'act' && finalInput.selector) {
  console.log("Passed && finalInput.selector !");
  workflowStep = { type: 'fill' };
} else {
  console.log("Failed && finalInput.selector !");
}

console.log("workflowStep:", workflowStep);
