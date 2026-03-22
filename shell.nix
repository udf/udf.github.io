{
  pkgs ? import <nixpkgs> { },
}:

pkgs.mkShell {
  nativeBuildInputs = with pkgs; [
    hugo
    git
    nodejs
    nodePackages.npm
  ];

  shellHook = ''
    export PATH="$PWD/node_modules/.bin:$PATH"
    echo "Hugo version: $(hugo version)"
    echo "Node version: $(node --version)"
  '';
}
