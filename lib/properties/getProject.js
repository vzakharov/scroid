module.exports = async function(projectName) {

    let projects = (
        await this.getProjects({projectName})
    )

    return projects.find(project => project.name == projectName)

}

