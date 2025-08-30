"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Code, Plus, Search, Filter, MoreHorizontal, Users, Clock, Star, Folder, Settings, LogOut } from "lucide-react"
import Link from "next/link"
import { useState, useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"

export default function DashboardPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [publicProjects, setPublicProjects] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'my' | 'public'>('my')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newProject, setNewProject] = useState({
    name: "",
    description: "",
    programmingLanguage: "js",
    isPublic: false
  })
  
  const { user, logout, isAuthenticated } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
      return
    }
    fetchProjects()
  }, [isAuthenticated, router])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const [myProjectsData, publicProjectsData] = await Promise.all([
        apiClient.getProjects(),
        apiClient.getPublicProjects()
      ])
      setProjects(Array.isArray(myProjectsData) ? myProjectsData : [])
      setPublicProjects(Array.isArray(publicProjectsData) ? publicProjectsData : [])
    } catch (err: any) {
      setError(err.message || 'Failed to fetch projects')
      setProjects([])
      setPublicProjects([])
    } finally {
      setLoading(false)
    }
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('Creating project:', newProject)
    setError('') // Clear any previous errors
    try {
      const result = await apiClient.createProject(newProject)
      console.log('Project created successfully:', result)
      setShowCreateModal(false)
      setNewProject({ name: "", description: "", programmingLanguage: "js", isPublic: false })
      fetchProjects()
    } catch (err: any) {
      console.error('Error creating project:', err)
      setError(err.message || 'Failed to create project')
    }
  }

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours} hours ago`
    const diffInDays = Math.floor(diffInHours / 24)
    if (diffInDays < 7) return `${diffInDays} days ago`
    return date.toLocaleDateString()
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Code className="w-8 h-8 text-purple-600" />
              <span className="text-xl font-bold">CollabCode</span>
            </Link>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <Input placeholder="Search projects..." className="pl-10 w-80" />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm">
              <Filter className="w-4 h-4 mr-2" />
              Filter
            </Button>
            <div className="flex items-center gap-2">
              <Avatar>
                <AvatarImage src={user?.avatar} />
                <AvatarFallback>{user?.name?.charAt(0) || 'U'}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">{user?.name}</span>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 min-h-screen">
          <div className="p-6">
            <Button 
              className="w-full bg-purple-600 hover:bg-purple-700"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </div>

          <nav className="px-4 space-y-2">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-purple-50 text-purple-700"
            >
              <Folder className="w-4 h-4" />
              All Projects
            </Link>
            <Link
              href="/dashboard/starred"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              <Star className="w-4 h-4" />
              Starred
            </Link>
            <Link
              href="/dashboard/shared"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              <Users className="w-4 h-4" />
              Shared with me
            </Link>
            <Link
              href="/dashboard/recent"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              <Clock className="w-4 h-4" />
              Recent
            </Link>
          </nav>

          <div className="absolute bottom-4 left-4 right-4 space-y-2">
            <Link
              href="/settings"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              <Settings className="w-4 h-4" />
              Settings
            </Link>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 w-full"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  {activeTab === 'my' ? 'My Projects' : 'Public Projects'}
                </h1>
                <p className="text-gray-600">
                  {activeTab === 'my' 
                    ? 'Manage and collaborate on your coding projects'
                    : 'Discover and explore public projects from the community'
                  }
                </p>
              </div>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('my')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === 'my'
                      ? 'bg-white text-purple-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  My Projects ({projects.length})
                </button>
                <button
                  onClick={() => setActiveTab('public')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === 'public'
                      ? 'bg-white text-purple-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Public Projects ({publicProjects.length})
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* Projects Grid */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-full"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
                    <div className="h-8 bg-gray-200 rounded w-16"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(activeTab === 'my' ? projects : publicProjects).map((project) => (
                <Card key={project._id} className="hover:shadow-lg transition-shadow cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg mb-1 flex items-center gap-2">
                          {project.name}
                          {project.isPublic && activeTab === 'my' && (
                            <Badge variant="outline" className="text-xs">Public</Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-sm">{project.description}</CardDescription>
                        {activeTab === 'public' && project.owner && (
                          <div className="flex items-center gap-2 mt-2">
                            <Avatar className="w-5 h-5">
                              <AvatarImage src={project.owner.avatar} />
                              <AvatarFallback className="text-xs">{project.owner.name?.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <span className="text-xs text-gray-500">by {project.owner.name}</span>
                          </div>
                        )}
                      </div>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between mb-3">
                      <Badge variant="secondary">{project.programmingLanguage}</Badge>
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Users className="w-4 h-4" />
                        {project.collaborators?.length || 0}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">{formatDate(project.updatedAt)}</span>
                      <Link href={`/editor/${project._id}`}>
                        <Button size="sm">Open</Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Create New Project Card - Only show in My Projects tab */}
              {activeTab === 'my' && (
                <Card 
                  className="border-dashed border-2 border-gray-300 hover:border-purple-400 transition-colors cursor-pointer"
                  onClick={() => setShowCreateModal(true)}
                >
                  <CardContent className="flex flex-col items-center justify-center h-48 text-center">
                    <Plus className="w-12 h-12 text-gray-400 mb-4" />
                    <h3 className="font-semibold text-gray-900 mb-2">Create New Project</h3>
                    <p className="text-sm text-gray-500">Start a new collaborative coding project</p>
                  </CardContent>
                </Card>
              )}

              {/* Empty state for public projects */}
              {activeTab === 'public' && publicProjects.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
                  <Code className="w-16 h-16 text-gray-300 mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No Public Projects Found</h3>
                  <p className="text-gray-500 max-w-md">
                    There are no public projects available at the moment. Check back later or create your own public project to share with the community!
                  </p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold mb-4">Create New Project</h2>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <Label htmlFor="projectName">Project Name</Label>
                <Input
                  id="projectName"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  placeholder="Enter project name"
                  required
                />
              </div>
              <div>
                <Label htmlFor="projectDescription">Description</Label>
                <Input
                  id="projectDescription"
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  placeholder="Enter project description"
                  required
                />
              </div>
              <div>
                <Label htmlFor="programmingLanguage">Programming Language</Label>
                <select
                  id="programmingLanguage"
                  value={newProject.programmingLanguage}
                  onChange={(e) => setNewProject({ ...newProject, programmingLanguage: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md"
                >
                  <option value="js">JavaScript</option>
                  <option value="jsx">JavaScript (JSX)</option>
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="cpp">C++</option>
                  <option value="c">C</option>
                  <option value="csharp">C#</option>
                  <option value="php">PHP</option>
                  <option value="ruby">Ruby</option>
                  <option value="go">Go</option>
                  <option value="rust">Rust</option>
                  <option value="swift">Swift</option>
                  <option value="kotlin">Kotlin</option>
                  <option value="html">HTML</option>
                  <option value="css">CSS</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isPublic"
                  checked={newProject.isPublic}
                  onChange={(e) => setNewProject({ ...newProject, isPublic: e.target.checked })}
                  className="rounded"
                />
                <Label htmlFor="isPublic">Make project public</Label>
              </div>
              <div className="flex gap-2 pt-4">
                <Button type="submit" className="flex-1">Create Project</Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
