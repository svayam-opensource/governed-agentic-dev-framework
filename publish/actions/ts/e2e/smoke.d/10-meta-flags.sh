# Meta flags must work with NO workspace resolved (an adopter's first commands).
has "$(gov --version)" "gov " "gov --version works without a workspace"
has "$(gov -v)"        "gov " "gov -v works"
has "$(gov --help)"    "command reference" "gov --help works without a workspace"
