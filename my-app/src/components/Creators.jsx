import React from 'react';

// Team member data - you can update these with actual information
const teamMembers = [
  {
    id: 1,
    name: "Amer Dajani",
    role: "ML Engineer & Backend Developer",
    skills: ["Machine Learning", "Backend", "Python"],
    contribution: "Served as the primary machine learning engineer and technical lead. Architected and implemented core ML algorithms and models while providing cross-functional support across all project domains. Coordinated technical decisions and system integration.",
    bio: "Passionate about creating innovative solutions for real-world problems. Experienced in ML engineering with a focus on scalable backend applications.",
    avatar: "/images/team/amer-dajani.jpg",
    github: "Amerdajani03",
    linkedin: "amer-dajani-98b8b52b0"
  },
  {
    id: 2,
    name: "Abdullah Muhammad",
    role: "Frontend Developer & ML Researcher", 
    skills: ["React", "HTML", "CSS", "JavaScript", "Research"],
    contribution: "Assisted with conceptual research and theoretical development for machine learning approaches and methodologies. Designed and implemented frontend application pages and user interface components.",
    bio: "Frontend developer with research expertise in machine learning concepts and theoretical frameworks. Focused on innovative approaches to climate-related AI solutions.",
    avatar: "/images/team/abdullah-muhammad.jpg",
    github: "abdxxlah",
    linkedin: "abdullah-m-2137ba237"
  },
  {
    id: 3,
    name: "Padme Icaza",
    role: "Project Manager & Team Lead",
    skills: ["Project Management", "Team Leadership", "Strategy"],
    contribution: "Directed project management operations and cross-functional team coordination. Led comprehensive documentation efforts while managing project timelines, resource allocation, and stakeholder communications.",
    bio: "Experienced project manager specializing in cross-functional team leadership and strategic planning. Passionate about delivering innovative solutions.",
    avatar: "/images/team/padme-icaza.jpg",
    github: "",
    linkedin: "padme-icaza-cocano-2254a035b"
  },
  {
    id: 4,
    name: "Jireh Vivar",
    role: "Frontend & Data Engineer",
    skills: ["React", "HTML", "CSS", "JavaScript", "Data Engineering"],
    contribution: "Built frontend components and data processing pipelines. Developed user interfaces and managed data flow between frontend and backend systems.",
    bio: "Frontend and data engineer with expertise in building scalable web applications and efficient data processing systems.",
    avatar: "/images/team/jireh-vivar.jpg",
    github: "jirehvivar",
    linkedin: "jireh-vivar-a56462132"
  },
  {
    id: 5,
    name: "Kamil Hudda",
    role: "Data Scientist",
    skills: ["Data Science", "Python", "Machine Learning", "Analytics"],
    contribution: "Conducted comprehensive data acquisition and research to identify relevant wildfire datasets. Performed extensive data cleaning, preprocessing, and preparation to enable machine learning model development.",
    bio: "Data scientist focused on extracting insights from complex datasets. Experienced in statistical modeling and machine learning applications.",
    avatar: "/images/team/kamil-hudda.jpg",
    github: "khudda126",
    linkedin: "kamil-hudda"
  },
  {
    id: 6,
    name: "Long Vu",
    role: "Full Stack Engineer",
    skills: ["React", "HTML", "CSS", "JavaScript", "Python", "API Integration"],
    contribution: "Designed and developed the complete user interface architecture and frontend framework. Subsequently integrated frontend systems with backend services and APIs to ensure seamless data flow and user experience.",
    bio: "Frontend integration engineer specializing in connecting user interfaces with backend systems. Passionate about creating smooth user experiences.",
    avatar: "/images/team/long-vu.jpg",
    github: "longvuwee",
    linkedin: "long-vu-440abc"
  }
];

export default function Creators() {
  return (
    <div className="creators-page">
      <div className="creators-container">
        {/* Header Section */}
        <div className="creators-header">
          <h1 className="creators-title">Meet the Team</h1>
          <p className="creators-subtitle">
            The brilliant minds behind FireCastX - combining expertise in machine learning, 
            environmental science, and cutting-edge web technologies to predict and visualize wildfire risks.
          </p>
        </div>

        {/* Team Grid */}
        <div className="team-grid">
          {teamMembers.map((member) => (
            <div key={member.id} className="team-card">
              <div className="card-header">
                <div className="avatar-container">
                  <a 
                    href={member.avatar} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="avatar-link"
                  >
                    <img 
                      src={member.avatar} 
                      alt={member.name}
                      className="member-avatar"
                    />
                    <div className="avatar-overlay"></div>
                  </a>
                </div>
                <div className="member-info">
                  <h3 className="member-name">{member.name}</h3>
                  <p className="member-role">{member.role}</p>
                </div>
              </div>

              <div className="card-content">
                <div className="skills-section">
                  <h4 className="section-title">Core Skills</h4>
                  <div className="skills-tags">
                    {member.skills.map((skill, index) => (
                      <span key={index} className="skill-tag">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="bio-section">
                  <h4 className="section-title">About</h4>
                  <p className="member-bio">{member.bio}</p>
                </div>

                <div className="contribution-section">
                  <h4 className="section-title">Project Contribution</h4>
                  <p className="member-contribution">{member.contribution}</p>
                </div>

                <div className="social-links">
                  {member.github ? (
                    <a 
                      href={`https://github.com/${member.github}`} 
                      className="social-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <i className="icon-github"></i>
                      GitHub
                    </a>
                  ) : (
                    <span className="social-link disabled">
                      <i className="icon-github"></i>
                      GitHub
                    </span>
                  )}
                  <a 
                    href={`https://linkedin.com/in/${member.linkedin}`} 
                    className="social-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <i className="icon-linkedin"></i>
                    LinkedIn
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Project Stats Section */}
        <div className="project-stats">
          <h2 className="stats-title">Project Impact</h2>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-number">500K+</div>
              <div className="stat-label">Data Points Processed</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">95%</div>
              <div className="stat-label">Model Accuracy</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">2</div>
              <div className="stat-label">ML Models Integrated</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">Real-time</div>
              <div className="stat-label">Weather Integration</div>
            </div>
          </div>
        </div>

        {/* Call to Action */}
        <div className="cta-section">
          <h3 className="cta-title">Interested in Our Work?</h3>
          <p className="cta-text">
            FireCastX is part of our ongoing research into climate technology and predictive modeling. 
            Connect with us to learn more about our methodologies and future developments.
          </p>
          <div className="cta-buttons">
            <a href="#/api" className="cta-button primary">
              Explore API
            </a>
            <a href="#/docs" className="cta-button secondary">
              Read Documentation
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}