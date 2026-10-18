// Package resource embeds the built React application, following GooseForum's resource pattern.
package resource

import (
	"embed"
	"io/fs"
)

//go:embed all:dist all:legacy
var resources embed.FS

func Assets() (fs.FS, error)             { return fs.Sub(resources, "dist") }
func Legacy(name string) ([]byte, error) { return resources.ReadFile("legacy/" + name) }
