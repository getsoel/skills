// Minimal glob -> RegExp + static-prefix helpers.
// Handles **, **/, *, ? - no brace expansion. `*` stays within a segment; `**` crosses `/`.

export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; out += "(?:[^/]*/)*"; } // **/ -> zero+ dirs
        else out += ".*";                                       // ** -> anything incl /
      } else {
        out += "[^/]*";                                         // * -> within a segment
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += /[.+^${}()|[\]\\]/.test(c) ? "\\" + c : c;
    }
  }
  return new RegExp("^" + out + "$");
}

// The non-wildcard directory prefix of a glob. `src/auth/**` -> `src/auth`; `**/x` -> "".
export function globStaticPrefix(glob: string): string {
  const cut = glob.search(/[*?]/);
  const head = cut === -1 ? glob : glob.slice(0, cut);
  const slash = head.lastIndexOf("/");
  return slash === -1 ? "" : head.slice(0, slash);
}
